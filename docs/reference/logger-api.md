---
sidebar_position: 2
title: Logger API
---

# Logger API

`createSomLogger(options)` returns a `SomLogger`, the logger you call everything on. `SomLogger` is exported as a type only, for annotating variables and parameters.

```ts
import { createSomLogger, type SomLogger } from 'som-otel'
```

## `createSom()`

`createSom(options)` returns a `Som` with a logger, a tracer, and a meter that share one configuration:

```ts
const som = createSom(options) // SomOptions

som.logger // SomLogger
som.tracer // SomTracer
som.meter // SomMeter
som.flush(): Promise<void>
som.shutdown(): Promise<void>
```

`flush()` and `shutdown()` act on all three signals. They wait for all of them, then reject with the single failure or an `AggregateError` if more than one fails. `shutdown()` also removes the page listeners. `SomOptions` is `SomLoggerOptions` plus `tracesEndpoint` and `metricsEndpoint`. See [Tracing](../guides/tracing.md) and [Metrics](../guides/metrics.md).

## `SomTracer`

```ts
tracer.startSpan(name, options?: SpanOptions): Span
tracer.trace<T>(name, fn: (span: Span) => T, options?: SpanOptions): T
tracer.flush(): Promise<void>
tracer.shutdown(): Promise<void>
tracer.droppedSpanCount: number
```

`SpanOptions` has `kind`, `attributes`, `links`, `parent`, and `startTime`. `trace()` ends the span when `fn` returns or its promise settles, and records a throw or rejection as an exception with `error` status.

## `Span`

```ts
span.setAttribute(key, value): Span
span.setAttributes(attributes): Span
span.addEvent(name, attributes?, time?): Span
span.recordException(error, attributes?, time?): Span
span.addLink(link): Span
span.setStatus({ code: 'ok' | 'error', message? }): Span
span.updateName(name): Span
span.end(endTime?): void
span.spanContext(): SpanContext
span.isRecording(): boolean
```

`end()` never throws, and after it every call is ignored. See [Tracing](../guides/tracing.md#span-methods) for the semantics.

## Severity helpers

```ts
logger.trace(body, attributes?, options?): Promise<void>
logger.debug(body, attributes?, options?): Promise<void>
logger.info(body, attributes?, options?): Promise<void>
logger.warn(body, attributes?, options?): Promise<void>
logger.error(body, attributes?, options?): Promise<void>
```

| Parameter    | Type                | Description                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------------- |
| `body`       | `LogAttributeValue` | Any [value type](../guides/writing-logs.md#attribute-values) or an `Error`. |
| `attributes` | `LogAttributes`     | Optional map of attribute names to values.                                  |
| `options`    | `LogOptions`        | Optional trace fields and event name.                                       |

## `log()`

```ts
logger.log(severity, body, attributes?, options?): Promise<void>
```

`severity` is `'trace' | 'debug' | 'info' | 'warn' | 'error'`. The helpers call `log()` with their name.

## `logRecord()`

```ts
logger.logRecord(record: OTelLogRecord): Promise<void>
```

Sends a record with full control over timestamps, severity number and text, trace fields, flags, and event name. See [Raw records](../guides/writing-logs.md#raw-records-with-logrecord).

## `flush()`

```ts
logger.flush(): Promise<void>
```

Sends all queued records now. Resolves when the exports finish; rejects if one fails (an `AggregateError` if several fail).

## `shutdown()`

```ts
logger.shutdown(): Promise<void>
```

Stops accepting new logs, removes the page listeners, and flushes the queue. Later log calls reject with `SomLogger has been shut down.`

## `droppedRecordCount`

```ts
logger.droppedRecordCount: number
```

Number of records dropped because the queue was full. Read-only.

## Promise behavior

All log methods return a promise that:

- **resolves** when the batch containing the record is exported successfully,
- **rejects** with an [`OtlpExportError`](../guides/retries-and-timeouts.md#otlpexporterror) when the export fails,
- **rejects** with `SomLogger batch queue is full.` or `SomLogger batch queue is full; oldest record dropped.` on overflow,
- **rejects** with a `TypeError` when a value cannot be encoded (non-finite number, out-of-range `bigint`),
- **rejects** with `SomLogger has been shut down.` after `shutdown()`.

The record is queued synchronously when the method is called, so an immediate `flush()` or `shutdown()` includes it.

## `LogOptions`

The optional last argument of `log()` and the helpers:

```ts
type LogOptions = { eventName?: string } & (
  | { traceId: string; spanId: string; traceFlags?: number; span?: never }
  | { span?: Span; traceId?: never; spanId?: never; traceFlags?: never }
)
```

`traceId` and `spanId` come together. `span` is shorthand for a span's own ids and cannot be combined with them. See [Trace correlation](../guides/trace-correlation.md).

## `OtlpHttpExporter`

`OtlpHttpExporter` is the transport `SomLogger` uses internally, exported for advanced use. Most apps never need it. It sends log records that are already in OTLP/JSON shape (`OtlpLogRecord`), and supports the same `retry`, `timeoutMs`, `compression`, and `keepalive` options. Unlike `SomLogger`, it does not retry or time out unless you ask for it:

```ts
import { OtlpHttpExporter } from 'som-otel'

const exporter = new OtlpHttpExporter({
  endpoint: 'https://collector.example.com/v1/logs',
  resourceAttributes: { 'service.name': 'storefront' },
  fetcher: fetch,
})

await exporter.export(records) // OtlpLogRecord[]
```

It has no queue or batching, and does not detect resources. Its options are `OtlpHttpExporterOptions`.
