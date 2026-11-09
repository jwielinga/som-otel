import { useEffect, useState } from 'react'

export type Polled<T> = {
  data: T
  error?: string
  updatedAt?: Date
}

// Calls fetchData now and every intervalMs; a failure keeps the last data and sets error.
export function usePolled<T>(
  fetchData: (signal: AbortSignal) => Promise<T>,
  initial: T,
  intervalMs: number,
): Polled<T> {
  const [polled, setPolled] = useState<Polled<T>>({ data: initial })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined

    const poll = async () => {
      try {
        const data = await fetchData(controller.signal)
        if (controller.signal.aborted) return
        setPolled({ data, updatedAt: new Date() })
      } catch (caught) {
        if (controller.signal.aborted) return
        setPolled((current) => ({
          ...current,
          error: caught instanceof Error ? caught.message : String(caught),
        }))
      }

      if (!controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), intervalMs)
      }
    }

    void poll()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [fetchData, intervalMs])

  return polled
}
