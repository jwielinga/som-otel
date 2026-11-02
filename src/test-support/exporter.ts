import { OtlpHttpExporter } from '../transport/http-exporter.js'
import type { OtlpHttpExporterOptions, OtlpLogRecord } from '../types.js'

export const record: OtlpLogRecord = {
  timeUnixNano: '1728000000000000000',
  severityNumber: 17,
  severityText: 'ERROR',
  body: { stringValue: 'payment failed' },
}

export function createExporter(options: Partial<OtlpHttpExporterOptions> = {}) {
  return new OtlpHttpExporter({
    endpoint: 'https://collector.example/v1/logs',
    resourceAttributes: { 'service.name': 'checkout' },
    fetcher: async () => new Response(null, { status: 204 }),
    ...options,
  })
}

// Answers each call from `responses` in order (204 once exhausted); a number is a bare status.
export function sequenceFetcher(
  responses: Array<number | Error | Response> = [],
) {
  const calls: RequestInit[] = []
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push(init ?? {})
    const next = responses[calls.length - 1] ?? 204
    if (next instanceof Error) throw next
    if (next instanceof Response) return next
    return new Response(null, { status: next })
  }
  return { calls, fetcher }
}
