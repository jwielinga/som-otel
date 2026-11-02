import type { SomSignal } from '../types.js'

export const DEFAULT_TIMEOUT_MS = 10_000

// How each signal is named in error messages.
export const SIGNAL_NAMES: Record<SomSignal, { noun: string; owner: string }> =
  {
    logs: { noun: 'log', owner: 'SomLogger' },
    traces: { noun: 'trace', owner: 'SomTracer' },
  }
