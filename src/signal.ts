import type { SomSignal } from './sdk.types.js'

// How each signal is named in error messages.
export const SIGNAL_NAMES: Record<SomSignal, { noun: string; owner: string }> =
  {
    logs: { noun: 'log', owner: 'SomLogger' },
    traces: { noun: 'trace', owner: 'SomTracer' },
  }
