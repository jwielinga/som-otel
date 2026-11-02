import { createOtlpLogsRequest } from '../otlp/encode-logs.js'
import { OtlpTransport } from './otlp-transport.js'
import { readPartialSuccess } from '../otlp/partial-success.js'
import type {
  OtlpHttpExporterOptions,
  OtlpLogRecord,
  OtlpRequestOptions,
  PartialSuccess,
} from '../types.js'

export { isFetchKeepaliveSupported, OtlpExportError } from './otlp-transport.js'

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
