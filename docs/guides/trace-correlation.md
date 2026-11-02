---
sidebar_position: 4
title: Trace correlation
---

# Trace correlation

Trace correlation links a log record to the span that was active when it was written, so you can jump from a trace to its logs in your backend.

## Per-call trace fields

Pass the fields in the last argument of `log()` and the severity helpers:

```ts
await logger.info(
  'Checkout completed',
  { orderId: 'order-42' },
  {
    traceId: '5b8efff798038103d269b633813fc60c',
    spanId: 'eee19b7ec3c1b174',
    traceFlags: 1,
    eventName: 'checkout.completed',
  },
)
```

| Field        | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `traceId`    | 32 lowercase hex characters.                                              |
| `spanId`     | 16 lowercase hex characters.                                              |
| `traceFlags` | W3C trace flags, for example `1` for sampled. Sent as the record `flags`. |
| `eventName`  | Marks the record as a named event, for example `checkout.completed`.      |

`traceFlags` is limited to its low 8 bits.

TypeScript enforces that `traceId` and `spanId` are given together, and that `traceFlags` only appears with them. `eventName` can be used alone.

:::note No format checks at runtime

Som trusts the types and does not validate id formats. Pass lowercase hex strings of the right length, or the collector may reject the record.

:::

## From a span

When you create spans with Som's [tracer](./tracing.md), pass the span itself. Som copies its `traceId`, `spanId`, and `traceFlags` into the record:

```ts
const { logger, tracer } = createSom({/* ... */})

await tracer.trace('checkout', async (span) => {
  await logger.info('Charging card', { orderId: 'order-42' }, { span })
})
```

`span` cannot be combined with explicit `traceId`, `spanId`, or `traceFlags`; TypeScript rejects it. A span that is not recording still correlates, and its `traceFlags` is sent as the record `flags`.

## Automatic correlation with a provider

Set `traceContext` to attach the active trace to **every** log automatically. It is a function that returns `{ traceId, spanId, traceFlags? }`, or `undefined` when there is no active trace:

```ts
const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  traceContext: () =>
    currentSpan && {
      traceId: currentSpan.traceId,
      spanId: currentSpan.spanId,
      traceFlags: currentSpan.flags,
    },
})
```

Som calls the provider each time it builds a record. Explicit trace fields or a `span` on a call always win over the provider, and a provider is skipped when an explicit `traceId` is given.

### With `@opentelemetry/api`

`traceContextFromApi` adapts the OpenTelemetry API for you:

```ts
import { context, trace } from '@opentelemetry/api'
import { createSomLogger, traceContextFromApi } from 'som-otel'

const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  traceContext: traceContextFromApi({ trace, context }),
})
```

It reads the span context of the currently active OpenTelemetry context on every log. Som does not depend on `@opentelemetry/api`; you pass the objects in.

## Raw records

`logRecord()` takes `traceId`, `spanId`, and `flags` on the record itself. The provider only applies when the record has **neither** `traceId` nor `spanId`:

```ts
await logger.logRecord({
  body: 'Background sync finished',
  traceId: '5b8efff798038103d269b633813fc60c',
  spanId: 'eee19b7ec3c1b174',
  flags: 1,
})
```
