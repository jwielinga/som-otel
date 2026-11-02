---
sidebar_position: 2
title: Writing logs
---

# Writing logs

## Severity helpers

Each helper takes a body, optional attributes, and optional [trace options](./trace-correlation.md):

```ts
await logger.trace('Cache lookup started', { key: 'homepage' })
await logger.debug('Cache lookup completed', { hit: true })
await logger.info('Checkout completed', { orderId: 'order-42', total: 12.5 })
await logger.warn('Inventory is low', { sku: 'sku-7', remaining: 2 })
await logger.error('Payment failed', { orderId: 'order-42', retryable: false })
```

The generic form takes the severity as the first argument:

```ts
await logger.log('info', 'User signed in', { userId: 'user-123' })
```

| Method  | OTel severity number | Severity text |
| ------- | -------------------- | ------------- |
| `trace` | 1 (`TRACE`)          | `TRACE`       |
| `debug` | 5 (`DEBUG`)          | `DEBUG`       |
| `info`  | 9 (`INFO`)           | `INFO`        |
| `warn`  | 13 (`WARN`)          | `WARN`        |
| `error` | 17 (`ERROR`)         | `ERROR`       |

For other severities (such as `FATAL`) use [`logRecord()`](#raw-records-with-logrecord).

## Bodies and attributes

The **body** is the main content of the record; **attributes** are structured key/value context. Both use the OpenTelemetry `AnyValue` model.

### Attribute values

| JavaScript value | OTLP value                  | Notes                                                                                                  |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `string`         | `stringValue`               |                                                                                                        |
| `boolean`        | `boolValue`                 |                                                                                                        |
| `number`         | `intValue` or `doubleValue` | Must be finite. Safe integers (up to 2^53 - 1) are sent as `intValue`, other numbers as `doubleValue`. |
| `bigint`         | `intValue`                  | Must fit a signed 64-bit integer.                                                                      |
| `Uint8Array`     | `bytesValue`                | Sent as base64 in JSON.                                                                                |
| array            | `arrayValue`                | Items can be any supported value.                                                                      |
| plain object     | `kvlistValue`               | Nested maps are fine.                                                                                  |
| `Error`          | map                         | See [Logging errors](./logging-errors.md).                                                             |

```ts
await logger.info('Order placed', {
  orderId: 'order-42', // string
  total: 12.5, // double
  items: 3, // int (a safe integer)
  quantity: 3n, // int64 (use bigint beyond 2^53 - 1)
  gift: false, // bool
  tags: ['promo', 'mobile'], // array
  shipping: { method: 'express', days: 2 }, // map
})
```

The body can be any of these values too, not just a string:

```ts
await logger.info({ message: 'Payment failed', retryable: false })
```

### Values Som rejects

Two values cannot be represented in OTLP. The log call's promise **rejects** with a `TypeError`, and the logger keeps working:

- A non-finite number (`NaN`, `Infinity`): `Log attribute "ratio" must be a finite number.`
- A `bigint` outside the signed 64-bit range: `Log attribute "id" must fit in a signed int64.`

The message names the offending key. Nested keys are dotted, for example `shipping.cost`.

### Values Som rewrites

- Circular references become the string `[Circular]`.
- Values nested deeper than `limits.maxValueDepth` become `[MaxDepthExceeded]`.
- Attributes beyond the count limit are dropped, and long strings can be truncated.

See [Attribute limits](./attribute-limits.md).

## Timestamps

Helper-made records set `timeUnixNano` and `observedTimeUnixNano` to the moment you called the method, with sub-millisecond precision. You do not pass timestamps to the helpers.

## Promises and failures

Every log method returns a `Promise<void>`. The promise resolves when the batch containing the record was exported successfully, and rejects when the export fails, the queue overflowed, or the record could not be encoded.

Await it when the caller cares about delivery:

```ts
try {
  await logger.info('Profile updated', { userId: 'user-123' })
} catch (error) {
  console.error('Could not export log record', error)
}
```

If you do not await it, handle the rejection yourself or the browser reports an unhandled promise rejection when an export fails. See [Fire-and-forget logging](./recipes.md#fire-and-forget-logging).

After `shutdown()`, new log calls reject with `SomLogger has been shut down.`

## Raw records with `logRecord()`

Use `logRecord()` when you need explicit timestamps, a specific OTel severity, trace correlation, flags, a dropped-attribute count, or an event name:

```ts
import { OTelSeverityNumber } from 'som-otel'

await logger.logRecord({
  timeUnixNano: BigInt(Date.now()) * 1_000_000n,
  severityNumber: OTelSeverityNumber.FATAL,
  severityText: 'FATAL',
  body: { message: 'Payment pipeline down', retryable: false },
  attributes: { orderId: 'order-42' },
  traceId: '5b8efff798038103d269b633813fc60c',
  spanId: 'eee19b7ec3c1b174',
  eventName: 'payment.failed',
})
```

The record type is `OTelLogRecord`. All fields are optional:

| Field                    | Type                    | Notes                                                              |
| ------------------------ | ----------------------- | ------------------------------------------------------------------ |
| `timeUnixNano`           | `bigint`                | When the event happened. Left unset if you omit it.                |
| `observedTimeUnixNano`   | `bigint`                | Defaults to now when omitted.                                      |
| `severityNumber`         | `OTelSeverityNumber`    | `OTelSeverityNumber` is a constant object, `UNSPECIFIED`–`FATAL4`. |
| `severityText`           | `string`                | Free text such as `'ERROR'`.                                       |
| `body`                   | any value               |                                                                    |
| `attributes`             | `Record<string, value>` | Subject to [attribute limits](./attribute-limits.md).              |
| `droppedAttributesCount` | `number`                | Added to the count of attributes Som drops itself.                 |
| `flags`                  | `number`                | Trace flags in the low 8 bits.                                     |
| `traceId`, `spanId`      | `string`                | Lowercase hex, 32 and 16 characters.                               |
| `eventName`              | `string`                | Marks the record as an event.                                      |

If a record has neither `traceId` nor `spanId`, the [`traceContext`](./trace-correlation.md) provider supplies them.

The helper types `OTelApplicationLog`, `OTelEvent`, and `OTelSimpleLog` narrow `OTelLogRecord` for common shapes (string or map bodies, required event name, string-only body).
