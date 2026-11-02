import { LogBatcher } from '../transport/batcher.js'
import { collectFailures } from '../utils/failures.js'
import {
  isFetchKeepaliveSupported,
  OtlpHttpExporter,
} from '../transport/http-exporter.js'
import { SomLogger } from '../logs/logger.js'
import { resolveLimits } from '../otlp/encode-logs.js'
import { createOtlpTracesRequest } from '../otlp/encode-traces.js'
import { OtlpTransport } from '../transport/otlp-transport.js'
import { flushOnPageUnload } from '../transport/page-unload.js'
import { readTracePartialSuccess } from '../otlp/partial-success.js'
import { detectResourceAttributes } from '../utils/resource.js'
import { resolveRetryPolicy } from '../transport/retry.js'
import type {
  BatchExporter,
  Emit,
  LogAttributes,
  OtlpLimits,
  OtlpLogRecord,
  OtlpSpan,
  SomLoggerOptions,
  SomOptions,
  SomSignal,
  TracePartialSuccess,
} from '../types.js'
import { Som } from './som.js'
import { resolveTracesEndpoint } from '../traces/traces-endpoint.js'
import { SomTracer } from '../traces/tracer.js'
import { DEFAULT_TIMEOUT_MS } from './core.constants.js'

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

// Delivery settings shared by every signal.
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

function createRequestOptions(options: SomLoggerOptions) {
  return { scope: options.scope, resourceSchemaUrl: options.resourceSchemaUrl }
}

function createLogExporter(
  options: SomLoggerOptions,
  emit: Emit,
): OtlpHttpExporter {
  return new OtlpHttpExporter({
    ...createTransportOptions(options),
    ...createRequestOptions(options),
    endpoint: options.endpoint,
    resourceAttributes: createResourceAttributes(options),
    onPartialSuccess: ({ rejectedLogRecords, errorMessage }) =>
      emit({
        type: 'partial-success',
        signal: 'logs',
        rejectedLogRecords,
        errorMessage,
      }),
  })
}

function createTraceExporter(
  options: SomOptions,
  emit: Emit,
): OtlpTransport<OtlpSpan, TracePartialSuccess> {
  const resourceAttributes = createResourceAttributes(options)
  const requestOptions = createRequestOptions(options)

  return new OtlpTransport<OtlpSpan, TracePartialSuccess>({
    ...createTransportOptions(options),
    endpoint: resolveTracesEndpoint(options.endpoint, options.tracesEndpoint),
    signal: 'traces',
    encode: (spans) =>
      JSON.stringify(
        createOtlpTracesRequest(resourceAttributes, spans, requestOptions),
      ),
    readPartialSuccess: readTracePartialSuccess,
    onPartialSuccess: ({ rejectedSpans, errorMessage }) =>
      emit({
        type: 'partial-success',
        signal: 'traces',
        rejectedSpans,
        errorMessage,
      }),
  })
}

function createBatcher<T>(
  options: SomLoggerOptions,
  exporter: BatchExporter<T>,
  emit: Emit,
  signal: SomSignal,
): LogBatcher<T> {
  const reportFailure = (items: readonly T[], error: unknown): never => {
    emit({ type: 'export-failed', signal, error, recordCount: items.length })
    throw error
  }

  return new LogBatcher<T>({
    ...options.batch,
    signal,
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

      const failures = collectFailures(results)
      if (failures.length > 0) throw failures[0]
    },
    onDropped: (totalDropped) =>
      emit({
        type: 'records-dropped',
        signal,
        reason: 'queue-full',
        totalDropped,
      }),
  })
}

function createLogBatcher(
  options: SomLoggerOptions,
  emit: Emit,
): LogBatcher<OtlpLogRecord> {
  return createBatcher(options, createLogExporter(options, emit), emit, 'logs')
}

function createSpanBatcher(
  options: SomOptions,
  emit: Emit,
): LogBatcher<OtlpSpan> {
  return createBatcher(
    options,
    createTraceExporter(options, emit),
    emit,
    'traces',
  )
}

function createLogger(
  options: SomLoggerOptions,
  batcher: LogBatcher<OtlpLogRecord>,
  limits: OtlpLimits,
  onShutdown?: () => void,
): SomLogger {
  return new SomLogger(batcher, {
    limits,
    traceContext: options.traceContext,
    onShutdown,
  })
}

function validateOptions(options: SomLoggerOptions): void {
  if (!options.endpoint.trim()) {
    throw new TypeError('endpoint must be a non-empty string.')
  }
  if (!options.serviceName.trim()) {
    throw new TypeError('serviceName must be a non-empty string.')
  }
}

export function createSomLogger(options: SomLoggerOptions): SomLogger {
  validateOptions(options)

  const batcher = createLogBatcher(options, createEmitter(options))
  return createLogger(
    options,
    batcher,
    resolveLimits(options.limits),
    flushOnPageUnload([batcher]),
  )
}

export function createSom(options: SomOptions): Som {
  validateOptions(options)

  const emit = createEmitter(options)
  const limits = resolveLimits(options.limits)
  const logBatcher = createLogBatcher(options, emit)
  const spanBatcher = createSpanBatcher(options, emit)

  return new Som(
    createLogger(options, logBatcher, limits),
    new SomTracer(spanBatcher, {
      limits,
      onError: (error) =>
        emit({
          type: 'export-failed',
          signal: 'traces',
          error,
          recordCount: 1,
        }),
    }),
    flushOnPageUnload([logBatcher, spanBatcher]),
  )
}
