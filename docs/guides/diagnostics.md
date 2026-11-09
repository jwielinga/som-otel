---
sidebar_position: 8
title: Diagnostics
---

# Diagnostics

Most failures happen in the background, after your log call has already returned: a batch fails to export, the queue overflows, the collector rejects part of a request. Log promises report some of these, and span export failures have no promise at all, because `span.end()` returns nothing. `onDiagnostic` gives you one place to observe them all, for logs, spans, and metrics.

```ts
const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  onDiagnostic(event) {
    switch (event.type) {
      case 'export-failed':
        console.warn(
          `Lost ${event.recordCount} ${event.signal} items`,
          event.error,
        )
        break
      case 'partial-success':
        console.warn(
          event.signal === 'logs'
            ? `${event.rejectedLogRecords} records rejected`
            : event.signal === 'traces'
              ? `${event.rejectedSpans} spans rejected`
              : `${event.rejectedDataPoints} data points rejected`,
          event.errorMessage,
        )
        break
      case 'invalid-measurement':
        console.warn(
          `Dropped ${event.value} for ${event.instrument}`,
          event.reason,
        )
        break
      case 'instrument-conflict':
        console.warn(`${event.instrument}: ${event.reason}`)
        break
      case 'records-dropped':
        console.warn(
          `Queue full, ${event.totalDropped} ${event.signal} dropped so far`,
        )
        break
    }
  },
})
```

`SomDiagnosticEvent` is a discriminated union, so TypeScript narrows each event by its `type`. Every event has a `signal`, `'logs'`, `'traces'`, or `'metrics'`. `partial-success` narrows further by `signal`.

## Events

| `type`                | When                                                         | Fields                                                                                                                  |
| --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `export-failed`       | A batch could not be exported, after all retries.            | `signal`, `error`, `recordCount`                                                                                        |
| `partial-success`     | The collector accepted a request but rejected some items.    | `signal`, `errorMessage?`, and `rejectedLogRecords` (logs), `rejectedSpans` (traces), or `rejectedDataPoints` (metrics) |
| `records-dropped`     | The queue was full and an item was dropped.                  | `signal`, `reason` (`'queue-full'`), `totalDropped`                                                                     |
| `invalid-measurement` | An instrument call was dropped because its value is invalid. | `signal` (`'metrics'`), `instrument`, `reason` (`'negative-counter-value'` or `'non-finite-value'`), `value`            |
| `instrument-conflict` | A second instrument asked for other histogram boundaries.    | `signal` (`'metrics'`), `instrument`, `reason` (`'boundaries-differ'`)                                                  |

`export-failed` fires for each failed batch, including page-unload sends, and also when a span or measurement cannot be encoded (`recordCount` is `1`). `records-dropped` fires once per dropped item, with a running total for that signal.

## Safe by design

- Som calls your callback synchronously and ignores anything it throws, so a bug in diagnostics code never breaks logging.
- Keep the callback fast and avoid logging from it with the same logger, which can create a loop when exports keep failing.

## Other signals

- `logger.droppedRecordCount`, `tracer.droppedSpanCount`, and `meter.droppedMeasurementCount` return the number of dropped items at any time.
- Log promises reject for failed exports. See [Writing logs](./writing-logs.md#promises-and-failures).

## Development logging

Print diagnostics only while developing (this example uses Vite's `import.meta.env.DEV`):

```ts
onDiagnostic: (event) => {
  if (import.meta.env.DEV) console.debug('[som]', event)
}
```
