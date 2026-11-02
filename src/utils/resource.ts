import type { NavigatorUAData, OTelAnyValue } from '../types.js'

export function detectResourceAttributes(): Record<string, OTelAnyValue> {
  const attributes: Record<string, OTelAnyValue> = {
    'telemetry.sdk.name': 'som-otel',
    'telemetry.sdk.language': 'webjs',
  }

  const nav = (globalThis as { navigator?: Navigator }).navigator
  if (!nav) return attributes

  if (nav.userAgent) attributes['user_agent.original'] = nav.userAgent
  if (nav.language) attributes['browser.language'] = nav.language

  const uaData = (nav as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData
  if (uaData) {
    if (uaData.brands) {
      attributes['browser.brands'] = uaData.brands.map(
        ({ brand, version }) => `${brand} ${version}`,
      )
    }
    if (uaData.mobile !== undefined)
      attributes['browser.mobile'] = uaData.mobile
    if (uaData.platform) attributes['browser.platform'] = uaData.platform
  }

  return attributes
}
