// The reasons of every rejected result, in order.
export function collectFailures(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
): unknown[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
}

// One failure is thrown as is; several become an AggregateError.
export function throwFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError([...failures], message)
}
