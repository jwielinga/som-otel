---
sidebar_position: 4.6
title: Metrics
---

# Metrics

Som can also send OpenTelemetry **metrics**, next to your logs and spans. You record values by hand through instruments; Som does not collect anything on its own.

## Create a meter

`createSom()` returns a logger, a tracer, and a meter that share one configuration:

```ts
import { createSom } from 'som-otel'

const som = createSom({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
})

const { meter } = som
```

`createSomLogger()` still returns only a logger. There is no metrics-only factory.

### Metrics endpoint

Metrics go to their own URL. By default Som derives it from `endpoint` by replacing a trailing `/logs` with `/metrics`, so `https://collector.example.com/v1/logs` becomes `https://collector.example.com/v1/metrics`. A query string stays in place.

Set `metricsEndpoint` to use any other URL. It is required when `endpoint` does not end in `/logs`; `createSom()` throws a `TypeError` otherwise. In that case set `tracesEndpoint` too.

```ts
const som = createSom({
  endpoint: 'https://logs.example.com/ingest',
  tracesEndpoint: 'https://traces.example.com/otlp/spans',
  metricsEndpoint: 'https://metrics.example.com/otlp/metrics',
  serviceName: 'storefront',
})
```

Everything else (`headers`, `batch`, `retry`, `timeoutMs`, `compression`, `keepalive`, `limits`, `scope`, resource options, `onDiagnostic`) applies to every signal. Each signal keeps its own queue and sends its own requests.

## Instruments

Create an instrument once, then call it as often as you like.

| Method                            | Records                                         | Call                          |
| --------------------------------- | ----------------------------------------------- | ----------------------------- |
| `meter.createCounter(name)`       | A value that only goes up, such as clicks.      | `counter.add(value, attrs?)`  |
| `meter.createUpDownCounter(name)` | A value that goes up and down, such as a queue. | `counter.add(value, attrs?)`  |
| `meter.createHistogram(name)`     | A distribution, such as request durations.      | `histogram.record(v, attrs?)` |
| `meter.createGauge(name)`         | A current value, such as memory in use.         | `gauge.record(value, attrs?)` |

Every method takes an optional second argument with `description` and `unit`. `createHistogram` also accepts `boundaries`.

```ts
const clicks = meter.createCounter('checkout.clicks', {
  description: 'Checkout button clicks',
  unit: '{click}',
})
clicks.add(1, { button: 'pay' })

const duration = meter.createHistogram('request.duration', { unit: 'ms' })
duration.record(42, { route: '/cart' })
```

Attributes follow the same rules as [log attributes](./writing-logs.md#attribute-values). Keep their values low-cardinality: every distinct set of attributes is its own series.

Instrument calls return `void` and never throw. A problem is reported through [`onDiagnostic`](./diagnostics.md), and `som.flush()` rejects when an export fails.

### Invalid values

Som drops a value instead of sending something a collector may reject, and reports an `invalid-measurement` diagnostic:

- a negative value on a counter (`negative-counter-value`)
- `NaN` or an infinite value on any instrument (`non-finite-value`)

### Histogram boundaries

Without `boundaries`, a histogram uses the OpenTelemetry defaults: `0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000`. Buckets are upper-inclusive, so a value of `5` counts in the bucket that ends at `5`.

Custom `boundaries` are sorted, and duplicates and non-finite numbers are ignored. Two histograms with the same name but different boundaries are sent as separate metrics.

## How measurements are sent

Each call is queued like a log record, and the queue is batched with the same `batch` options (20 measurements or 5 seconds by default). When a batch is sent, Som collapses it into **delta** data points, one per metric and attribute set:

- A counter or up-down counter sends the sum of its values.
- A histogram sends the count, sum, min, max and bucket counts.
- A gauge sends only the last value.

Each delta data point covers the time from the first to the last measurement in the batch. Som only sends delta temporality, so a backend that needs cumulative values, such as Prometheus, needs the collector's `deltatocumulative` processor. See [Collector setup](./collector-setup.md#metrics).

A histogram that recorded a negative value omits its `sum`, as OTLP requires.

## Flushing and shutdown

`som.flush()` and `som.shutdown()` handle logs, spans, and metrics together. If more than one fails, the error is an `AggregateError`. `meter.flush()` and `meter.shutdown()` work on metrics alone. After shutdown, instrument calls are ignored. `meter.droppedMeasurementCount` returns how many measurements were dropped because the queue was full.

Queued measurements are also sent on `pagehide` and when the page is hidden. See [Page unload](./page-unload.md).

## Not supported yet

- Observable (callback-based) instruments.
- Cumulative temporality.
- Exponential histograms, exemplars, and metric views.
- A metrics-only factory.
