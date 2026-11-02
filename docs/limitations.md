---
sidebar_position: 5
title: Limitations
---

# Limitations

What Som deliberately does not do, so you can plan around it.

## Scope

- **Logs and manual traces.** Som sends logs and spans. There are no metrics. Spans are created by hand; there is no automatic instrumentation, no ambient active span, and no sampling beyond following a parent's decision. See [Tracing](./guides/tracing.md).
- **No automatic capture.** Som does not hook `console`, uncaught errors, network requests, or navigation. See [Recipes](./guides/recipes.md).
- **JSON over HTTP only.** No protobuf, no gRPC, no WebSocket transports.
- **One endpoint per signal.** Logs go to one collector URL and spans to another.

## Delivery

- **In-memory queue.** Records stay in memory until the batch threshold, the timer, `flush()`, `shutdown()`, or a page hide triggers an export. They are not saved across page loads.
- **Retries cover one page session.** A batch that exhausts its retries is lost.
- **Bounded queue.** Once `maxQueueSize` is reached, new logs are rejected, or the oldest dropped with `overflowStrategy: 'drop-oldest'`.
- **Unload delivery is best-effort.** It depends on the browser's support for Fetch `keepalive`, and on the 64 KiB body limit. See [Page unload](./guides/page-unload.md).
- **Sequential batches.** Batches are sent one at a time, so a slow collector delays later batches.

## Data

- **No per-logger default attributes.** Use `resourceAttributes` for stable context or wrap the logger. See [Recipes](./guides/recipes.md#add-context-to-every-log).
- **No sampling or filtering.** Every call you make is sent. Filter before calling the logger.
- **No redaction.** Som does not scrub attribute values. Do not log secrets or personal data you do not want to send.
- **`telemetry.sdk.version` is not set.**

## Security

Everything in a browser bundle is visible to users. Do not include collector credentials with broad privileges, and treat all log content as client-visible. See [Configuration](./guides/configuration.md#request-headers) and [Collector setup](./guides/collector-setup.md#authentication).
