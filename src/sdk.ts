import { LogBatcher } from './batcher.js'
import { isFetchKeepaliveSupported, OtlpHttpExporter } from './http-exporter.js'
import { SomLogger } from './logger.js'
import { resolveLimits, type OtlpLogRecord } from './otlp.js'
import { createOtlpTracesRequest, type OtlpSpan } from './otlp-trace.js'
import { OtlpTransport } from './otlp-transport.js'
import {
  readTracePartialSuccess,
  type TracePartialSuccess,
} from './partial-success.js'
import { detectResourceAttributes } from './resource.js'
import { resolveRetryPolicy } from './retry.js'
import type {
  LogAttributes,
  SomDiagnosticEvent,
  SomLoggerOptions,
  SomOptions,
} from './sdk.types.js'
import { Som } from './som.js'
import { SomTracer } from './tracer.js'

const DEFAULT_TIMEOUT_MS = 10_000

type Emit = (event: SomDiagnosticEvent) => void

// What the batcher needs from an exporter, whatever the signal.
type BatchExporter<T> = {
  export(items: readonly T[]): Promise<void>
  exportOnUnload(items: readonly T[]): Promise<void>
  splitForUnload(items: readonly T[]): T[][]
}

type Unloadable = { flushOnUnload(): Promise<void> }

function createResourceAttributes(options: SomLoggerOptions): LogAttributes {
  return {
    ...((options.detectResource ?? true) ? detectResourceAttributes() : {}),
    ...options.resourceAttributes,
    'service.name': options.serviceName,
    ...(options.serviceVersion === undefined
      ? {}
      : { 'service.version': options.serviceVersion }),
  }
}

function createEmitter(options: SomLoggerOptions): Emit {
  return (event) => {
    try {
      options.onDiagnostic?.(event)
    } catch {
      // A throwing diagnostics callback must not break logging.
    }
  }
}

function createTransportOptions(options: SomLoggerOptions) {
  const fetcher = options.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new TypeError(
      'fetch is not available in this environment; provide the fetcher option.',
    )
  }

  return {
    headers: options.headers,
    fetcher,
    keepalive: (options.keepalive ?? true) && isFetchKeepaliveSupported(),
    compression: options.compression,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: resolveRetryPolicy(options.retry),
  }
}

function createExporter(
  options: SomLoggerOptions,
  emit: Emit,
): OtlpHttpExporter {
  return new OtlpHttpExporter({
    ...createTransportOptions(options),
    endpoint: options.endpoint,
    resourceAttributes: createResourceAttributes(options),
    scope: options.scope,
    resourceSchemaUrl: options.resourceSchemaUrl,
    onPartialSuccess: ({ rejectedLogRecords, errorMessage }) =>
      emit({ type: 'partial-success', rejectedLogRecords, errorMessage }),
  })
}

function createTraceExporter(
  options: SomLoggerOptions,
  endpoint: string,
): OtlpTransport<OtlpSpan, TracePartialSuccess> {
  const resourceAttributes = createResourceAttributes(options)
  const requestOptions = {
    scope: options.scope,
    resourceSchemaUrl: options.resourceSchemaUrl,
  }

  return new OtlpTransport<OtlpSpan, TracePartialSuccess>({
    ...createTransportOptions(options),
    endpoint,
    signal: 'trace',
    encode: (spans) =>
      JSON.stringify(
        createOtlpTracesRequest(resourceAttributes, spans, requestOptions),
      ),
    readPartialSuccess: readTracePartialSuccess,
  })
}

const TRACES_PATH = /^([^?#]*?)\/logs(\/?(?:[?#].*)?)$/

// An explicit tracesEndpoint wins; otherwise the logs endpoint's trailing /logs becomes /traces.
function resolveTracesEndpoint(options: SomOptions): string {
  if (options.tracesEndpoint !== undefined) {
    if (!options.tracesEndpoint.trim()) {
      throw new TypeError('tracesEndpoint must be a non-empty string.')
    }
    return options.tracesEndpoint
  }

  const derived = options.endpoint.replace(TRACES_PATH, '$1/traces$2')
  if (derived === options.endpoint) {
    throw new TypeError(
      'tracesEndpoint is required when endpoint does not end in "/logs".',
    )
  }
  return derived
}

function createBatcher<T>(
  options: SomLoggerOptions,
  exporter: BatchExporter<T>,
  emit: Emit,
  names: { owner: string; signal: 'log' | 'trace' },
): LogBatcher<T> {
  const reportFailure = (items: readonly T[], error: unknown): never => {
    emit({ type: 'export-failed', error, recordCount: items.length })
    throw error
  }

  return new LogBatcher<T>({
    ...options.batch,
    ...names,
    sendBatch: (items) =>
      exporter
        .export(items)
        .catch((error: unknown) => reportFailure(items, error)),
    // Starts every request synchronously: the page may be gone after the handler returns.
    sendBatchOnUnload: async (items) => {
      const results = await Promise.allSettled(
        exporter
          .splitForUnload(items)
          .map((chunk) =>
            exporter
              .exportOnUnload(chunk)
              .catch((error: unknown) => reportFailure(chunk, error)),
          ),
      )

      const failure = results.find((result) => result.status === 'rejected')
      if (failure) throw failure.reason as unknown
    },
    onDropped: (totalDropped) =>
      emit({ type: 'records-dropped', reason: 'queue-full', totalDropped }),
  })
}

function createLogBatcher(
  options: SomLoggerOptions,
  emit: Emit,
): LogBatcher<OtlpLogRecord> {
  return createBatcher(options, createExporter(options, emit), emit, {
    owner: 'SomLogger',
    signal: 'log',
  })
}

function createSpanBatcher(
  options: SomOptions,
  emit: Emit,
): LogBatcher<OtlpSpan> {
  const exporter = createTraceExporter(options, resolveTracesEndpoint(options))
  return createBatcher(options, exporter, emit, {
    owner: 'SomTracer',
    signal: 'trace',
  })
}

// Returns a function that removes the listeners again.
function flushOnPageUnload(batchers: readonly Unloadable[]): () => void {
  const flushOnPageHide = (): void => {
    for (const batcher of batchers) {
      void batcher.flushOnUnload().catch(() => undefined)
    }
  }
  const flushWhenHidden = (): void => {
    if (document.visibilityState === 'hidden') flushOnPageHide()
  }

  globalThis.addEventListener?.('pagehide', flushOnPageHide)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', flushWhenHidden)
  }

  return () => {
    globalThis.removeEventListener?.('pagehide', flushOnPageHide)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }
}

export function createSomLogger(options: SomLoggerOptions): SomLogger {
  validateOptions(options)

  const emit = createEmitter(options)
  const batcher = createLogBatcher(options, emit)

  return new SomLogger(batcher, {
    limits: resolveLimits(options.limits),
    traceContext: options.traceContext,
    onShutdown: flushOnPageUnload([batcher]),
  })
}

export function createSom(options: SomOptions): Som {
  validateOptions(options)

  const emit = createEmitter(options)
  const logBatcher = createLogBatcher(options, emit)
  const spanBatcher = createSpanBatcher(options, emit)

  return new Som(
    new SomLogger(logBatcher, {
      limits: resolveLimits(options.limits),
      traceContext: options.traceContext,
    }),
    new SomTracer(spanBatcher),
    flushOnPageUnload([logBatcher, spanBatcher]),
  )
}

function validateOptions(options: SomLoggerOptions): void {
  if (!options.endpoint.trim()) {
    throw new TypeError('endpoint must be a non-empty string.')
  }
  if (!options.serviceName.trim()) {
    throw new TypeError('serviceName must be a non-empty string.')
  }
}
