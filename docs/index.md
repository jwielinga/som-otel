---
slug: /
sidebar_position: 1
title: Introduction
---

# Som

Som (`som-otel`) is a small, browser-first TypeScript library that sends [OpenTelemetry](https://opentelemetry.io/) **logs**, **spans**, and **metrics** to any collector that speaks OTLP/HTTP. It is a library, not an application: it has no UI, and it never collects anything on its own. Your code decides what to log, trace, and measure.

```ts
import { createSomLogger } from 'som-otel'

const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
})

await logger.info('Checkout completed', { orderId: 'order-42', total: 12.5 })
```

## What you get

- **Simple API.** `trace`, `debug`, `info`, `warn`, and `error` helpers, plus `log()` and `logRecord()` when you need full control. See [Writing logs](./guides/writing-logs.md).
- **Batching.** Records are queued and sent together, by count or by timer, with a bounded queue. See [Batching and flushing](./guides/batching.md).
- **Delivery that survives real networks.** Retries with backoff, `Retry-After` support, per-request timeouts, and partial-success reporting. See [Retries and timeouts](./guides/retries-and-timeouts.md).
- **Page-unload delivery.** Fetch `keepalive` and an automatic flush on `pagehide` and when the page is hidden. See [Page unload](./guides/page-unload.md).
- **Rich records.** `Error` objects become `exception.*` attributes, trace ids correlate logs with spans, and timestamps have sub-millisecond precision. See [Logging errors](./guides/logging-errors.md) and [Trace correlation](./guides/trace-correlation.md).
- **Payload control.** Resource and scope attributes, schema URLs, browser resource detection, gzip compression, and attribute limits. See [Resource and scope](./guides/resource-and-scope.md), [Compression](./guides/compression.md), and [Attribute limits](./guides/attribute-limits.md).
- **Spans too.** `createSom()` returns a logger and a tracer. Start spans by hand, link logs to them, and send both signals through the same delivery pipeline. See [Tracing](./guides/tracing.md).
- **Metrics too.** `createSom()` also returns a meter with counters, up-down counters, histograms, and gauges, sent as delta metrics to their own endpoint. See [Metrics](./guides/metrics.md).
- **Observability of the SDK itself.** An `onDiagnostic` callback reports failed exports, partial success, invalid measurements, and dropped records. See [Diagnostics](./guides/diagnostics.md).
- **Easy to test.** Inject your own `fetch` to run without a collector. See [Testing](./guides/testing.md).

## What Som is not

- It sends **logs, spans, and metrics**, nothing else.
- It does not instrument anything automatically: no `console` capture, uncaught errors, navigation, or `fetch` spans, and no built-in metrics. [Recipes](./guides/recipes.md) shows how to wire those up yourself.
- It does not keep logs or spans across page loads; queued items live in memory.
- It sends OTLP **JSON** over HTTP, not protobuf or gRPC.

## Where to start

1. [Getting started](./getting-started.mdx) installs the package and sends a first log.
2. [Configuration](./guides/configuration.md) explains the required options and the collector endpoint.
3. [Collector setup](./guides/collector-setup.md) covers CORS, which browsers need before logs arrive.
4. The [options reference](./reference/options.md) lists every option and default in one place.

## Contributing

See [Contributing](./contributing.md) for local setup, checks, documentation preview, and pull request conventions.
