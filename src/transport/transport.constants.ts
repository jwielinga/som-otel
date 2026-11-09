import type { RetryPolicy } from '../types.js'

export const DEFAULT_MAX_BATCH_SIZE = 20
export const DEFAULT_MAX_QUEUE_SIZE = 1_000
export const DEFAULT_SCHEDULED_DELAY_MS = 5_000

export const LOGS_PATH_PATTERN = /^([^?#]*?)\/logs(\/?(?:[?#].*)?)$/

// Browsers cap in-flight keepalive bodies at 64 KiB; stay below it.
export const KEEPALIVE_MAX_BODY_BYTES = 63 * 1024

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
}

// OTLP/HTTP: only these statuses are retryable.
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503, 504,
])
