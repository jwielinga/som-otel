import { LOGS_PATH_PATTERN } from './transport.constants.js'

// An explicit `<signal>Endpoint` wins; otherwise the logs endpoint's trailing /logs becomes /<signal>.
export function resolveSignalEndpoint(
  signal: 'traces' | 'metrics',
  logsEndpoint: string,
  explicitEndpoint?: string,
): string {
  const option = `${signal}Endpoint`

  if (explicitEndpoint !== undefined) {
    if (!explicitEndpoint.trim()) {
      throw new TypeError(`${option} must be a non-empty string.`)
    }
    return explicitEndpoint
  }

  const derived = logsEndpoint.replace(LOGS_PATH_PATTERN, `$1/${signal}$2`)
  if (derived === logsEndpoint) {
    throw new TypeError(
      `${option} is required when endpoint does not end in "/logs".`,
    )
  }
  return derived
}
