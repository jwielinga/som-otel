import type { OTelJsonMetric, OTelJsonSpan, OtlpLogRecord } from '../types.js'

type JsonAttribute = { key: string; value?: unknown }

type JsonScope = {
  name: string
  version?: string
  attributes?: JsonAttribute[]
}

// Each request carries one signal; the other list is empty.
export type CollectedPayload = {
  resourceLogs: Array<{
    schemaUrl?: string
    resource: { attributes: JsonAttribute[] }
    scopeLogs: Array<{
      schemaUrl?: string
      scope: JsonScope
      logRecords: OtlpLogRecord[]
    }>
  }>
  resourceSpans: Array<{
    schemaUrl?: string
    resource: { attributes: JsonAttribute[] }
    scopeSpans: Array<{
      schemaUrl?: string
      scope: JsonScope
      spans: OTelJsonSpan[]
    }>
  }>
  resourceMetrics: Array<{
    schemaUrl?: string
    resource: { attributes: JsonAttribute[] }
    scopeMetrics: Array<{
      schemaUrl?: string
      scope: JsonScope
      metrics: OTelJsonMetric[]
    }>
  }>
}

export type CollectedRequest = {
  url: string
  // Header names are lowercased.
  headers: Record<string, string>
  keepalive: boolean
  signal: AbortSignal | undefined
  bodyBytes: number
  compressed: boolean
  payload: CollectedPayload
  // The parsed request exactly as sent, without the normalizing empty lists of `payload`.
  body: unknown
  records: OtlpLogRecord[]
  spans: OTelJsonSpan[]
  metrics: OTelJsonMetric[]
}

// A number is a bare status response; an Error is thrown as a network failure.
export type Script =
  number | Error | 'hang' | Response | ((request: CollectedRequest) => Response)

export function statusResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function decode(
  url: string,
  init: RequestInit,
): CollectedRequest | Promise<CollectedRequest> {
  const headers = Object.fromEntries(
    new Headers(init.headers).entries(),
  ) as Record<string, string>

  const build = (
    text: string,
    bodyBytes: number,
    compressed: boolean,
  ): CollectedRequest => {
    const parsed = JSON.parse(text) as Partial<CollectedPayload>
    const payload: CollectedPayload = {
      resourceLogs: [],
      resourceSpans: [],
      resourceMetrics: [],
      ...parsed,
    }
    return {
      url,
      headers,
      keepalive: init.keepalive === true,
      signal: init.signal ?? undefined,
      bodyBytes,
      compressed,
      payload,
      body: parsed,
      records: payload.resourceLogs.flatMap((resource) =>
        resource.scopeLogs.flatMap((scope) => scope.logRecords),
      ),
      spans: payload.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
      metrics: payload.resourceMetrics.flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      ),
    }
  }

  const body = init.body
  if (typeof body === 'string') {
    return build(body, new TextEncoder().encode(body).length, false)
  }
  if (body instanceof Uint8Array) {
    return gunzip(body as Uint8Array<ArrayBuffer>).then((text) =>
      build(text, body.byteLength, true),
    )
  }
  throw new TypeError('FakeCollector received an unsupported request body.')
}

// In-process OTLP/HTTP collector: pass `fetcher` to the SDK, then inspect `requests`.
export class FakeCollector {
  readonly requests: CollectedRequest[] = []
  private readonly script: Script[] = []
  private fallback: Script = 204
  private gate: Promise<void> | undefined

  // Each request is recorded before its response is decided, so it is visible
  // as soon as the SDK calls fetch (string bodies are recorded synchronously).
  readonly fetcher: typeof fetch = async (input, init = {}) => {
    const decoded = decode(String(input), init)
    const request = decoded instanceof Promise ? await decoded : decoded
    this.requests.push(request)

    if (this.gate) await this.gate
    return this.respond(this.script.shift() ?? this.fallback, request)
  }

  get records(): OtlpLogRecord[] {
    return this.requests.flatMap((request) => request.records)
  }

  get spans(): OTelJsonSpan[] {
    return this.requests.flatMap((request) => request.spans)
  }

  get metrics(): OTelJsonMetric[] {
    return this.requests.flatMap((request) => request.metrics)
  }

  // String bodies of every received record, in arrival order.
  get bodies(): Array<string | undefined> {
    return this.records.map((record) => record.body?.stringValue)
  }

  // Responses for the next requests, in order.
  enqueue(...scripts: Script[]): void {
    this.script.push(...scripts)
  }

  // Response once the queue is empty.
  setFallback(script: Script): void {
    this.fallback = script
  }

  // Delays every response until the returned function is called.
  hold(): () => void {
    let release!: () => void
    this.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    return () => {
      this.gate = undefined
      release()
    }
  }

  private respond(
    script: Script,
    request: CollectedRequest,
  ): Response | Promise<Response> {
    if (script === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      })
    }
    if (script instanceof Error) throw script
    if (typeof script === 'number') return statusResponse(script)
    if (typeof script === 'function') return script(request)
    return script
  }
}
