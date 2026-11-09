---
sidebar_position: 1
title: Options
---

# Options

All options are fields of `SomLoggerOptions`, passed to `createSomLogger()`. `createSom()` takes `SomOptions`, which is the same plus `tracesEndpoint` and `metricsEndpoint`, and applies every option to logs, spans, and metrics.

```ts
import { createSomLogger, type SomLoggerOptions } from 'som-otel'
```

## Required

| Option        | Type     | Description                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| `endpoint`    | `string` | Complete OTLP/HTTP logs URL. Som adds no path. Cannot be empty. |
| `serviceName` | `string` | Becomes the `service.name` resource attribute. Cannot be empty. |

## Traces (`createSom` only)

| Option            | Type     | Default                                       | Description                                                                                                                        |
| ----------------- | -------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tracesEndpoint`  | `string` | `endpoint` with trailing `/logs` → `/traces`  | Complete OTLP/HTTP traces URL. Required when `endpoint` does not end in `/logs`. [Tracing](../guides/tracing.md#traces-endpoint)   |
| `metricsEndpoint` | `string` | `endpoint` with trailing `/logs` → `/metrics` | Complete OTLP/HTTP metrics URL. Required when `endpoint` does not end in `/logs`. [Metrics](../guides/metrics.md#metrics-endpoint) |

## Identity and request

| Option               | Type                     | Default            | Description                                                                           |
| -------------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| `serviceVersion`     | `string`                 | unset              | `service.version` resource attribute.                                                 |
| `resourceAttributes` | `LogAttributes`          | `{}`               | Extra resource attributes. See [Resource and scope](../guides/resource-and-scope.md). |
| `headers`            | `Record<string, string>` | `{}`               | Extra request headers, such as `Authorization`.                                       |
| `fetcher`            | `typeof fetch`           | `globalThis.fetch` | Replacement `fetch`, for tests or custom environments.                                |

## Batching

`batch` is an object of `SomLoggerBatchOptions`. See [Batching and flushing](../guides/batching.md).

| Field              | Type                            | Default        | Description                                      |
| ------------------ | ------------------------------- | -------------- | ------------------------------------------------ |
| `maxBatchSize`     | `number`                        | `20`           | Records per request. Positive integer.           |
| `maxQueueSize`     | `number`                        | `1000`         | Records waiting to be sent. Positive integer.    |
| `scheduledDelayMs` | `number`                        | `5000`         | Timer delay in ms, between `0` and `2147483647`. |
| `overflowStrategy` | `'reject-new' \| 'drop-oldest'` | `'reject-new'` | What to drop when the queue is full.             |

## Delivery

| Option      | Type                             | Default   | Description                                                                                          |
| ----------- | -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `keepalive` | `boolean`                        | `true`    | Set the Fetch `keepalive` flag when the browser supports it. [Page unload](../guides/page-unload.md) |
| `timeoutMs` | `number`                         | `10000`   | Per-attempt timeout in ms. `0` disables. [Retries and timeouts](../guides/retries-and-timeouts.md)   |
| `retry`     | `SomLoggerRetryOptions \| false` | see below | Retry policy. `false` makes one attempt.                                                             |

`retry` fields, all optional:

| Field               | Default | Description                                            |
| ------------------- | ------- | ------------------------------------------------------ |
| `maxAttempts`       | `3`     | Total attempts including the first.                    |
| `initialDelayMs`    | `1000`  | Base backoff delay.                                    |
| `maxDelayMs`        | `30000` | Backoff cap, and the longest `Retry-After` Som honors. |
| `backoffMultiplier` | `2`     | Growth factor per retry.                               |

## Payload

| Option              | Type               | Default           | Description                                                                  |
| ------------------- | ------------------ | ----------------- | ---------------------------------------------------------------------------- |
| `detectResource`    | `boolean`          | `true`            | Add `telemetry.sdk.*`, `user_agent.original`, and `browser.*` attributes.    |
| `scope`             | `SomLoggerScope`   | `{ name: 'som' }` | Instrumentation scope. [Resource and scope](../guides/resource-and-scope.md) |
| `resourceSchemaUrl` | `string`           | unset             | Schema URL for the resource.                                                 |
| `compression`       | `'none' \| 'gzip'` | `'none'`          | Gzip request bodies. [Compression](../guides/compression.md)                 |
| `limits`            | `SomLoggerLimits`  | see below         | Attribute limits. [Attribute limits](../guides/attribute-limits.md)          |

`scope` fields, all optional: `name` (default `'som'`), `version`, `attributes`, `schemaUrl`.

`limits` fields, all optional:

| Field                       | Default    | Description                                                     |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| `attributeCountLimit`       | `128`      | Maximum attributes per record, span, span event, and span link. |
| `attributeValueLengthLimit` | `Infinity` | Maximum string attribute length.                                |
| `maxValueDepth`             | `20`       | Maximum nesting depth of values.                                |
| `eventCountLimit`           | `128`      | Maximum events per span (spans only).                           |
| `linkCountLimit`            | `128`      | Maximum links per span (spans only).                            |

## Correlation and observability

| Option         | Type                                  | Default | Description                                                                                           |
| -------------- | ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `traceContext` | `() => TraceContext \| undefined`     | unset   | Supplies trace ids for every log. [Trace correlation](../guides/trace-correlation.md)                 |
| `onDiagnostic` | `(event: SomDiagnosticEvent) => void` | unset   | Observe failed exports, partial success, and dropped records. [Diagnostics](../guides/diagnostics.md) |

## Full example

```ts
const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  serviceVersion: '2.1.0',
  resourceAttributes: { 'deployment.environment.name': 'production' },
  headers: { Authorization: `Bearer ${token}` },
  batch: {
    maxBatchSize: 50,
    maxQueueSize: 1_000,
    scheduledDelayMs: 2_000,
    overflowStrategy: 'drop-oldest',
  },
  keepalive: true,
  timeoutMs: 10_000,
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
  },
  detectResource: true,
  scope: { name: 'storefront-web', version: '2.1.0' },
  compression: 'gzip',
  limits: {
    attributeCountLimit: 128,
    attributeValueLengthLimit: 4096,
    maxValueDepth: 20,
  },
  traceContext: () => activeTrace(),
  onDiagnostic: (event) => console.warn(event),
})
```
