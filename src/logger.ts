import type { LogBatcher } from './batcher.js'
import { nowUnixNano } from './clock.js'
import {
  createOtlpLogRecord,
  DEFAULT_LIMITS,
  encodeOtlpLogRecord,
  type OtlpLimits,
  type OtlpLogRecord,
  type OtlpRecordExtras,
} from './otlp.js'
import type { OTelLogRecord } from './otel.types.js'
import type {
  LogAttributeValue,
  LogAttributes,
  LogOptions,
  LogSeverity,
  TraceContextProvider,
} from './sdk.types.js'

export type SomLoggerInit = {
  limits?: OtlpLimits
  traceContext?: TraceContextProvider
  onShutdown?: () => void
}

const TRACE_FLAGS_MASK = 0xff

export class SomLogger {
  private readonly batcher: LogBatcher<OtlpLogRecord>
  private readonly limits: OtlpLimits
  private readonly traceContext: TraceContextProvider | undefined
  private readonly onShutdown: (() => void) | undefined
  private isShutdown = false

  constructor(batcher: LogBatcher<OtlpLogRecord>, options: SomLoggerInit = {}) {
    this.batcher = batcher
    this.limits = options.limits ?? DEFAULT_LIMITS
    this.traceContext = options.traceContext
    this.onShutdown = options.onShutdown
  }

  // Records dropped because the pending queue was full.
  get droppedRecordCount(): number {
    return this.batcher.droppedCount
  }

  log(
    severity: LogSeverity,
    body: LogAttributeValue,
    attributes: LogAttributes = {},
    options?: LogOptions,
  ): Promise<void> {
    return this.enqueueRecord(() =>
      createOtlpLogRecord(
        severity,
        body,
        attributes,
        this.resolveExtras(options),
        this.limits,
      ),
    )
  }

  logRecord(record: OTelLogRecord): Promise<void> {
    return this.enqueueRecord(() =>
      encodeOtlpLogRecord(
        {
          ...this.withTraceContext(record),
          observedTimeUnixNano: record.observedTimeUnixNano ?? nowUnixNano(),
        },
        this.limits,
      ),
    )
  }

  // Fills trace fields from the provider unless the record carries its own.
  private withTraceContext(record: OTelLogRecord): OTelLogRecord {
    if (record.traceId !== undefined || record.spanId !== undefined) {
      return record
    }

    const context = this.traceContext?.()
    if (context === undefined) return record

    return {
      ...record,
      traceId: context.traceId,
      spanId: context.spanId,
      flags: record.flags ?? toFlags(context.traceFlags),
    }
  }

  private resolveExtras(options: LogOptions | undefined): OtlpRecordExtras {
    const trace = options?.span
      ? options.span.spanContext()
      : options?.traceId === undefined
        ? this.traceContext?.()
        : options

    return {
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      flags: toFlags(trace?.traceFlags),
      eventName: options?.eventName,
    }
  }

  private enqueueRecord(createRecord: () => OtlpLogRecord): Promise<void> {
    if (this.isShutdown) {
      return Promise.reject(new Error('SomLogger has been shut down.'))
    }

    // The executor runs synchronously, so the record is queued before flush()/shutdown().
    return new Promise<void>((resolve) => {
      resolve(this.batcher.add(createRecord()))
    })
  }

  flush(): Promise<void> {
    return this.batcher.flush()
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
    this.onShutdown?.()
    return this.batcher.shutdown()
  }

  trace(
    body: LogAttributeValue,
    attributes?: LogAttributes,
    options?: LogOptions,
  ): Promise<void> {
    return this.log('trace', body, attributes, options)
  }

  debug(
    body: LogAttributeValue,
    attributes?: LogAttributes,
    options?: LogOptions,
  ): Promise<void> {
    return this.log('debug', body, attributes, options)
  }

  info(
    body: LogAttributeValue,
    attributes?: LogAttributes,
    options?: LogOptions,
  ): Promise<void> {
    return this.log('info', body, attributes, options)
  }

  warn(
    body: LogAttributeValue,
    attributes?: LogAttributes,
    options?: LogOptions,
  ): Promise<void> {
    return this.log('warn', body, attributes, options)
  }

  error(
    body: LogAttributeValue,
    attributes?: LogAttributes,
    options?: LogOptions,
  ): Promise<void> {
    return this.log('error', body, attributes, options)
  }
}

function toFlags(traceFlags: number | undefined): number | undefined {
  return traceFlags === undefined ? undefined : traceFlags & TRACE_FLAGS_MASK
}
