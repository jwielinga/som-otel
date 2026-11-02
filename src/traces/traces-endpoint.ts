import { LOGS_PATH_PATTERN } from './traces.constants.js'

// An explicit tracesEndpoint wins; otherwise the logs endpoint's trailing /logs becomes /traces.
export function resolveTracesEndpoint(
  logsEndpoint: string,
  tracesEndpoint?: string,
): string {
  if (tracesEndpoint !== undefined) {
    if (!tracesEndpoint.trim()) {
      throw new TypeError('tracesEndpoint must be a non-empty string.')
    }
    return tracesEndpoint
  }

  const derived = logsEndpoint.replace(LOGS_PATH_PATTERN, '$1/traces$2')
  if (derived === logsEndpoint) {
    throw new TypeError(
      'tracesEndpoint is required when endpoint does not end in "/logs".',
    )
  }
  return derived
}
