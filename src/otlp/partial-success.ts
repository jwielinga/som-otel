import type {
  JsonExportResponse,
  PartialSuccess,
  RejectedKey,
  Rejection,
  TracePartialSuccess,
} from '../types.js'

function toRejection(
  body: JsonExportResponse,
  key: RejectedKey,
): Rejection | undefined {
  const partial = body.partialSuccess
  if (!partial) return undefined

  const count = Number(partial[key] ?? 0)
  const rejected = Number.isFinite(count) ? count : 0
  const errorMessage = partial.errorMessage || undefined

  return rejected > 0 || errorMessage ? { rejected, errorMessage } : undefined
}

// A 200 response can still report rejected items; clients must not retry them.
async function readRejection(
  response: Response,
  key: RejectedKey,
): Promise<Rejection | undefined> {
  if (response.status !== 200) return undefined
  if (!response.headers.get('Content-Type')?.includes('json')) return undefined

  try {
    return toRejection(
      JSON.parse(await response.text()) as JsonExportResponse,
      key,
    )
  } catch {
    return undefined
  }
}

export async function readPartialSuccess(
  response: Response,
): Promise<PartialSuccess | undefined> {
  const rejection = await readRejection(response, 'rejectedLogRecords')
  return (
    rejection && {
      rejectedLogRecords: rejection.rejected,
      errorMessage: rejection.errorMessage,
    }
  )
}

export async function readTracePartialSuccess(
  response: Response,
): Promise<TracePartialSuccess | undefined> {
  const rejection = await readRejection(response, 'rejectedSpans')
  return (
    rejection && {
      rejectedSpans: rejection.rejected,
      errorMessage: rejection.errorMessage,
    }
  )
}
