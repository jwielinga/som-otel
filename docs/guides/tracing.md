---
sidebar_position: 4.5
title: Tracing
---

# Tracing

Som can also send OpenTelemetry **spans**, so one setup covers your logs and the traces they belong to. Spans are created by hand: Som does not instrument `fetch`, navigation, or anything else on its own.

## Create a tracer

`createSom()` returns a logger and a tracer that share one configuration:

```ts
import { createSom } from 'som-otel'

const som = createSom({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
})

const { logger, tracer } = som
```

`createSomLogger()` still works and returns only a logger.

### Traces endpoint

Spans go to a separate URL. By default Som derives it from `endpoint` by replacing a trailing `/logs` with `/traces`, so `https://collector.example.com/v1/logs` becomes `https://collector.example.com/v1/traces`. A query string stays in place.

Set `tracesEndpoint` to use any other URL. It is required when `endpoint` does not end in `/logs`; `createSom()` throws a `TypeError` otherwise.

```ts
const som = createSom({
  endpoint: 'https://logs.example.com/ingest',
  tracesEndpoint: 'https://traces.example.com/otlp/spans',
  serviceName: 'storefront',
})
```

Everything else (`headers`, `batch`, `retry`, `timeoutMs`, `compression`, `keepalive`, `limits`, `scope`, resource options, `onDiagnostic`) applies to both signals. Each signal keeps its own queue and sends its own requests.

## Start and end a span

```ts
const span = tracer.startSpan('GET /cart/:id', {
  kind: 'client',
  attributes: { 'http.request.method': 'GET' },
})

span.setAttribute('http.response.status_code', 200)
span.end()
```

A span is exported when you call `end()`. A span you never end is never sent. `end()` returns `void` and never throws: a failed export is reported through [`onDiagnostic`](./diagnostics.md), and `som.flush()` rejects.

Name spans with a low-cardinality description such as `GET /cart/:id`, and put the specifics in attributes.

### Options

| Option       | Description                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `kind`       | `'internal'` (default), `'server'`, `'client'`, `'producer'`, or `'consumer'`.                                                |
| `attributes` | Initial attributes. Same value types as [log attributes](./writing-logs.md#attribute-values).                                 |
| `links`      | Links to other spans: `{ context, attributes? }`, where `context` is a span context. A link to an invalid context is ignored. |
| `parent`     | A `Span` or a `{ traceId, spanId, traceFlags? }` object. Without it the span starts a new trace.                              |
| `startTime`  | A `Date`, epoch milliseconds (fractions allowed), or epoch nanoseconds as a `bigint`. Default: now.                           |

`end(endTime?)` takes the same time types.

## Span methods

All of them return the span, except `end()`, `spanContext()`, and `isRecording()`.

| Method                                          | Description                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `setAttribute(key, value)` / `setAttributes(o)` | Set attributes. A later value replaces an earlier one.                                              |
| `addEvent(name, attributes?, time?)`            | Record a timestamped event.                                                                         |
| `recordException(error, attributes?, time?)`    | Record an `exception` event with `exception.type`, `exception.message`, and `exception.stacktrace`. |
| `addLink({ context, attributes? })`             | Link to another span.                                                                               |
| `setStatus({ code, message? })`                 | `'error'` with an optional message, or `'ok'`.                                                      |
| `updateName(name)`                              | Rename the span.                                                                                    |
| `end(endTime?)`                                 | Finish the span and queue it for export.                                                            |
| `spanContext()`                                 | `{ traceId, spanId, traceFlags }` of this span.                                                     |
| `isRecording()`                                 | `false` once the span has ended, or if it was never sampled.                                        |

`recordException()` does not change the status. Call `setStatus({ code: 'error' })` yourself. The status follows the OpenTelemetry rules: it starts unset, `ok` is final, and the message is only kept for `error`.

After `end()`, every call on the span is ignored, and a second `end()` does nothing.

## Wrap a function

`tracer.trace(name, fn, options?)` runs `fn` in a new span and ends it for you. A throw or a rejected promise is recorded on the span, the status is set to `error`, and the error is rethrown.

```ts
const cart = await tracer.trace('load cart', async (span) => {
  span.setAttribute('cart.id', cartId)
  return await fetchCart(cartId)
})
```

For an async function the span ends when the promise settles. The return value is passed through unchanged.

## Parent and child spans

Browsers have no ambient "active span", so Som does not guess a parent. Pass it explicitly:

```ts
await tracer.trace('checkout', async (checkout) => {
  await tracer.trace('validate cart', () => validate(), { parent: checkout })
  await tracer.trace('charge card', () => charge(), { parent: checkout })
})
```

A child continues its parent's trace and records the parent's span id as `parentSpanId`. You can also continue a trace that started elsewhere by passing its ids as `parent`, for example `{ traceId, spanId, traceFlags }` read from an incoming header. Ids are checked: a `parent` with an invalid or all-zero id is ignored and the span starts a new trace, as the OpenTelemetry spec asks. Uppercase hex is accepted and sent in lowercase.

### Sampling

Som does not sample on its own. A new trace is always sampled. A child follows its parent's decision: when the parent's `traceFlags` has the sampled bit (`0x01`) unset, the child is not recorded and never exported, but it still carries the trace context so further children and logs stay consistent.

## Correlate logs with spans

Pass the span in the log options to attach its trace and span ids to the record. See [Trace correlation](./trace-correlation.md#from-a-span).

```ts
await logger.error('Payment failed', { orderId: 'order-42' }, { span })
```

## Limits

[`limits`](./attribute-limits.md) applies to spans too, and adds two span-only limits:

| Limit                 | Default | Effect                                                                            |
| --------------------- | ------- | --------------------------------------------------------------------------------- |
| `attributeCountLimit` | `128`   | Per span, per event, and per link. Excess is counted in `droppedAttributesCount`. |
| `eventCountLimit`     | `128`   | Excess events are dropped and counted in `droppedEventsCount`.                    |
| `linkCountLimit`      | `128`   | Excess links are dropped and counted in `droppedLinksCount`.                      |

## Flushing and shutdown

`som.flush()` and `som.shutdown()` handle logs and spans together. If both fail, the error is an `AggregateError`. `tracer.flush()` and `tracer.shutdown()` work on spans alone.

After shutdown, `startSpan()` returns a span that is not recording. Spans still queued when the page is hidden are sent with `keepalive`, the same way as logs. See [Page unload](./page-unload.md).

`tracer.droppedSpanCount` returns the number of spans dropped because the queue was full.

## Collector

The collector needs an OTLP/HTTP traces receiver and a traces pipeline. See [Collector setup](./collector-setup.md#traces).
