// Rejects with `createError()` after `ms`; `onTimeout` (e.g. abort) runs after the rejection is queued.
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  createError: () => Error,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject first so the abort's own rejection cannot win the race.
      reject(createError())
      onTimeout?.()
    }, ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
