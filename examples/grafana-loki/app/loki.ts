import { fetchLokiEntries, type LokiEntry } from './loki-client'
import { usePolled } from './use-polled'

type LokiTail = {
  entries: LokiEntry[]
  error?: string
  updatedAt?: Date
}

const NO_ENTRIES: LokiEntry[] = []

export function useLokiTail(intervalMs = 2000): LokiTail {
  const { data, error, updatedAt } = usePolled(
    fetchLokiEntries,
    NO_ENTRIES,
    intervalMs,
  )
  return { entries: data, error, updatedAt }
}
