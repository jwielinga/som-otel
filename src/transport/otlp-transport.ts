import { computeBackoffMs, parseRetryAfter, sleep } from './retry.js'
import { raceTimeout } from './timeout.js'
import type {
  Body,
  OtlpTransportOptions,
  Payload,
  RetryPolicy,
} from '../types.js'
import { SIGNAL_NAMES } from '../core/core.constants.js'
import {
  KEEPALIVE_MAX_BODY_BYTES,
  RETRYABLE_STATUSES,
} from './transport.constants.js'

export class OtlpExportError extends Error {
  readonly status: number | undefined
  readonly retryable: boolean
  readonly retryAfterMs: number | undefined

  constructor(
    message: string,
    options: {
      retryable: boolean
      status?: number
      retryAfterMs?: number
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'OtlpExportError'
    this.status = options.status
    this.retryable = options.retryable
    this.retryAfterMs = options.retryAfterMs
  }
}

// Older browsers lack fetch `keepalive` and silently ignore the flag.
export function isFetchKeepaliveSupported(): boolean {
  return typeof Request !== 'undefined' && 'keepalive' in Request.prototype
}

function fitsKeepaliveLimit(body: Body): boolean {
  if (typeof body !== 'string') {
    return body.byteLength <= KEEPALIVE_MAX_BODY_BYTES
  }
  // UTF-8 is never shorter than the UTF-16 length, so skip encoding huge bodies.
  if (body.length > KEEPALIVE_MAX_BODY_BYTES) return false
  return new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BODY_BYTES
}

// Anything fetch itself throws (network, CORS, abort) is worth retrying.
function toExportError(error: unknown): OtlpExportError {
  if (error instanceof OtlpExportError) return error
  return new OtlpExportError(
    error instanceof Error ? error.message : String(error),
    { retryable: true, cause: error },
  )
}

// Signal-agnostic OTLP/HTTP delivery: compression, keepalive, timeout, retry, partial success.
export class OtlpTransport<TItem, TPartial> {
  private readonly endpoint: string
  private readonly noun: string
  private readonly encodeItems: OtlpTransportOptions<TItem, TPartial>['encode']
  private readonly readPartialSuccess: OtlpTransportOptions<
    TItem,
    TPartial
  >['readPartialSuccess']
  private readonly headers: Readonly<Record<string, string>>
  private readonly fetcher: typeof fetch
  private readonly keepalive: boolean
  private readonly compression: 'none' | 'gzip'
  private readonly timeoutMs: number
  private readonly retry: RetryPolicy | undefined
  private readonly onPartialSuccess:
    OtlpTransportOptions<TItem, TPartial>['onPartialSuccess'] | undefined

  constructor(options: OtlpTransportOptions<TItem, TPartial>) {
    this.endpoint = options.endpoint
    this.noun = SIGNAL_NAMES[options.signal].noun
    this.encodeItems = options.encode
    this.readPartialSuccess = options.readPartialSuccess
    this.headers = { ...options.headers }
    this.fetcher = options.fetcher
    this.keepalive = options.keepalive ?? false
    this.compression = options.compression ?? 'none'
    this.timeoutMs = options.timeoutMs ?? 0
    this.retry = options.retry
    this.onPartialSuccess = options.onPartialSuccess
  }

  async export(items: readonly TItem[]): Promise<void> {
    const payload = await this.compress(this.encode(items))
    const keepalive = this.keepalive && fitsKeepaliveLimit(payload.body)

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(payload, keepalive)
      } catch (error) {
        const delayMs = this.retryDelayMs(error, attempt)
        if (delayMs === undefined) throw error
        await sleep(delayMs)
      }
    }
  }

  // Page-unload path: the request starts synchronously and is never compressed or retried.
  async exportOnUnload(items: readonly TItem[]): Promise<void> {
    const payload = this.encode(items)
    return this.attempt(
      payload,
      this.keepalive && fitsKeepaliveLimit(payload.body),
    )
  }

  // Splits items so each keepalive request fits the browser body limit.
  splitForUnload(items: readonly TItem[]): TItem[][] {
    if (!this.keepalive) return [[...items]]

    const split = (batch: readonly TItem[]): TItem[][] => {
      if (batch.length <= 1 || fitsKeepaliveLimit(this.encode(batch).body)) {
        return [[...batch]]
      }
      const middle = Math.ceil(batch.length / 2)
      return [...split(batch.slice(0, middle)), ...split(batch.slice(middle))]
    }

    return split(items)
  }

  private encode(items: readonly TItem[]): Payload {
    return { body: this.encodeItems(items) }
  }

  private async compress(payload: Payload): Promise<Payload> {
    if (
      this.compression !== 'gzip' ||
      typeof CompressionStream === 'undefined'
    ) {
      return payload
    }

    const bytes =
      typeof payload.body === 'string'
        ? new TextEncoder().encode(payload.body)
        : payload.body
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream('gzip'))

    return {
      body: new Uint8Array(await new Response(stream).arrayBuffer()),
      contentEncoding: 'gzip',
    }
  }

  // Returns undefined when the failure should not be retried.
  private retryDelayMs(error: unknown, attempt: number): number | undefined {
    const retry = this.retry
    if (!retry || attempt >= retry.maxAttempts) return undefined
    if (!(error instanceof OtlpExportError) || !error.retryable) {
      return undefined
    }

    if (error.retryAfterMs === undefined) {
      return computeBackoffMs(retry, attempt)
    }
    // A server asking for a longer pause than we allow is not worth waiting on.
    return error.retryAfterMs > retry.maxDelayMs
      ? undefined
      : error.retryAfterMs
  }

  private httpError(response: Response): OtlpExportError {
    const statusText = response.statusText ? ` ${response.statusText}` : ''
    return new OtlpExportError(
      `OTLP ${this.noun} request failed: ${response.status}${statusText}`,
      {
        status: response.status,
        retryable: RETRYABLE_STATUSES.has(response.status),
        retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
      },
    )
  }

  private async attempt(payload: Payload, keepalive: boolean): Promise<void> {
    try {
      const response = await this.send(payload, keepalive)
      if (!response.ok) throw this.httpError(response)
      await this.reportPartialSuccess(response)
    } catch (error) {
      throw toExportError(error)
    }
  }

  private send(payload: Payload, keepalive: boolean): Promise<Response> {
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined
    // Detach from `this`: browser fetch throws "Illegal invocation" as a method.
    const fetcher = this.fetcher
    const request = fetcher(this.endpoint, {
      method: 'POST',
      headers: this.headersFor(payload),
      body: payload.body,
      ...(keepalive ? { keepalive: true } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    })

    if (!controller) return request
    return raceTimeout(
      request,
      this.timeoutMs,
      () =>
        new OtlpExportError(
          `OTLP ${this.noun} request timed out after ${this.timeoutMs}ms`,
          { retryable: true },
        ),
      () => controller.abort(),
    )
  }

  private headersFor(payload: Payload): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(payload.contentEncoding === undefined
        ? {}
        : { 'Content-Encoding': payload.contentEncoding }),
      ...this.headers,
    }
  }

  private async reportPartialSuccess(response: Response): Promise<void> {
    if (!this.onPartialSuccess) return

    const partial = await this.readPartialSuccess(response)
    if (!partial) return

    try {
      this.onPartialSuccess(partial)
    } catch {
      // A throwing callback must not fail (and so retry) an export the collector accepted.
    }
  }
}
