import {
  createOtlpLogsRequest,
  type OtlpLogRecord,
  type OtlpRequestOptions,
} from './otlp.js'
import { OtlpTransport } from './otlp-transport.js'
import { readPartialSuccess, type PartialSuccess } from './partial-success.js'
import type { RetryPolicy } from './retry.js'
import type { LogAttributes } from './sdk.types.js'

export { isFetchKeepaliveSupported, OtlpExportError } from './otlp-transport.js'

export type OtlpHttpExporterOptions = OtlpRequestOptions & {
  endpoint: string
  resourceAttributes: LogAttributes
  headers?: Readonly<Record<string, string>>
  fetcher: typeof fetch
  keepalive?: boolean
  compression?: 'none' | 'gzip'
  // Per-attempt timeout; unset or 0 disables.
  timeoutMs?: number
  // Unset means a single attempt.
  retry?: RetryPolicy
  onPartialSuccess?: (partial: PartialSuccess) => void
}

export class OtlpHttpExporter extends OtlpTransport<
  OtlpLogRecord,
  PartialSuccess
> {
  constructor(options: OtlpHttpExporterOptions) {
    const requestOptions: OtlpRequestOptions = {
      scope: options.scope,
      resourceSchemaUrl: options.resourceSchemaUrl,
    }

    super({
      endpoint: options.endpoint,
      signal: 'logs',
      encode: (records) =>
        JSON.stringify(
          createOtlpLogsRequest(
            options.resourceAttributes,
            records,
            requestOptions,
          ),
        ),
      readPartialSuccess,
      headers: options.headers,
      fetcher: options.fetcher,
      keepalive: options.keepalive,
      compression: options.compression,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      onPartialSuccess: options.onPartialSuccess,
    })
  }
}
