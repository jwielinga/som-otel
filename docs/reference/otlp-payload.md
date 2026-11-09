---
sidebar_position: 4
title: OTLP payload
---

# OTLP payload

This page shows exactly what Som sends, which helps when you test, debug a collector, or write a custom receiver.

## The request

- Method: `POST` to your `endpoint`.
- Headers: `Content-Type: application/json`, `Content-Encoding: gzip` when compressing, plus your `headers`.
- Body: an OTLP/JSON `ExportLogsServiceRequest` with one `resourceLogs` entry and one `scopeLogs` entry. Every record of the batch is in `logRecords`.

## Example

For this code:

```ts
const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  serviceVersion: '2.1.0',
  detectResource: false,
})

await logger.info('Checkout completed', { orderId: 'order-42', total: 12.5 })
```

Som sends:

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "storefront" } },
          { "key": "service.version", "value": { "stringValue": "2.1.0" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "som" },
          "logRecords": [
            {
              "timeUnixNano": "1791201600000000000",
              "observedTimeUnixNano": "1791201600000000000",
              "severityNumber": 9,
              "severityText": "INFO",
              "body": { "stringValue": "Checkout completed" },
              "attributes": [
                { "key": "orderId", "value": { "stringValue": "order-42" } },
                { "key": "total", "value": { "doubleValue": 12.5 } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Encoding rules

| Item               | Encoding                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| Timestamps         | Unix time in nanoseconds as a **decimal string**, for example `"1791201600000000000"`. |
| 64-bit integers    | Decimal strings: `intValue: "9007199254740993"`.                                       |
| Numbers            | Safe integers as `intValue` (a decimal string), other numbers as `doubleValue`.        |
| Bytes              | `bytesValue`, base64.                                                                  |
| Trace and span ids | Hex strings, as you provided them. An invalid id is left out; see below.               |
| Severity           | `severityNumber` (an OTel number) and `severityText` (upper-case name for helpers).    |
| Maps and arrays    | `kvlistValue.values[]` of `{ key, value }`, and `arrayValue.values[]`.                 |
| Unset fields       | Omitted from the JSON.                                                                 |
| Event records      | `eventName` carries the event name.                                                    |
| Dropped attributes | `droppedAttributesCount`, only when greater than zero for helper-made records.         |

## Invalid ids

A collector answers `400` to a request with one malformed id (wrong length or characters), and the whole batch is lost. Som therefore sends only ids that are valid: `traceId` is 32 and `spanId` is 16 hex characters, not all zeros, in either case. An invalid `traceId` or `spanId` on a log record is left out (both are, when either is invalid), an invalid span `parent` starts a new trace, and a span link to an invalid context is ignored.

## Partial success responses

A `200` JSON response can carry `{"partialSuccess": {"rejectedLogRecords": "2", "errorMessage": "…"}}`. Som surfaces it as a [`partial-success` diagnostic](../guides/diagnostics.md).

## Traces

Spans use the same transport and encoding rules, posted to the traces endpoint as an OTLP/JSON `ExportTraceServiceRequest` with one `resourceSpans` entry and one `scopeSpans` entry. Every span of the batch is in `spans`.

```ts
const { tracer } = createSom({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  detectResource: false,
})

tracer
  .startSpan('GET /cart', { kind: 'client' })
  .setAttribute('cart.items', 3)
  .end()
```

Som sends it to `https://collector.example.com/v1/traces`:

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "storefront" } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "som" },
          "spans": [
            {
              "traceId": "5b8efff798038103d269b633813fc60c",
              "spanId": "eee19b7ec3c1b174",
              "flags": 1,
              "name": "GET /cart",
              "kind": 3,
              "startTimeUnixNano": "1791201600000000000",
              "endTimeUnixNano": "1791201600120000000",
              "attributes": [
                { "key": "cart.items", "value": { "intValue": "3" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

| Item           | Encoding                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Ids            | `traceId` is 32 and `spanId` 16 lowercase hex characters, never all zeros.                            |
| `parentSpanId` | Present only for child spans.                                                                         |
| `flags`        | The W3C trace flags, `1` when sampled.                                                                |
| `kind`         | `1` internal, `2` server, `3` client, `4` producer, `5` consumer.                                     |
| `status`       | Omitted when unset. `{ "code": 1 }` is ok, `{ "code": 2, "message": "…" }` is error.                  |
| Events         | `events[]` of `{ timeUnixNano, name, attributes?, droppedAttributesCount? }`.                         |
| Links          | `links[]` of `{ traceId, spanId, flags?, attributes?, droppedAttributesCount? }`.                     |
| Dropped counts | `droppedAttributesCount`, `droppedEventsCount`, and `droppedLinksCount`, only when greater than zero. |

A `200` response can carry `{"partialSuccess": {"rejectedSpans": "2", "errorMessage": "…"}}`, which becomes a `partial-success` diagnostic with `signal: 'traces'`.

## Metrics

Metrics use the same transport and encoding rules, posted to the metrics endpoint as an OTLP/JSON `ExportMetricsServiceRequest` with one `resourceMetrics` entry and one `scopeMetrics` entry. Every metric of the batch is in `metrics`.

```ts
const { meter } = createSom({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  detectResource: false,
})

const clicks = meter.createCounter('checkout.clicks', { unit: '{click}' })
clicks.add(1, { button: 'pay' })
clicks.add(2, { button: 'pay' })
```

Som sends it to `https://collector.example.com/v1/metrics`:

```json
{
  "resourceMetrics": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "storefront" } }
        ]
      },
      "scopeMetrics": [
        {
          "scope": { "name": "som" },
          "metrics": [
            {
              "name": "checkout.clicks",
              "unit": "{click}",
              "sum": {
                "aggregationTemporality": 1,
                "isMonotonic": true,
                "dataPoints": [
                  {
                    "attributes": [
                      { "key": "button", "value": { "stringValue": "pay" } }
                    ],
                    "startTimeUnixNano": "1791201600000000000",
                    "timeUnixNano": "1791201600000000000",
                    "asInt": "3"
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

| Item                     | Encoding                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Counter                  | A `sum` with `isMonotonic: true`.                                                                                               |
| Up-down counter          | A `sum` with `isMonotonic: false`.                                                                                              |
| Gauge                    | A `gauge` with the last value of the batch and no `startTimeUnixNano`.                                                          |
| Histogram                | A `histogram` with `count`, `sum`, `min`, `max`, `bucketCounts`, and `explicitBounds`. `sum` is omitted after a negative value. |
| `aggregationTemporality` | Always `1` (delta).                                                                                                             |
| Values                   | `asInt` (a decimal string) when every value is a safe integer, otherwise `asDouble`.                                            |
| Data points              | One per metric and attribute set in a batch. They cover the time from the first to the last measurement.                        |

A `200` response can carry `{"partialSuccess": {"rejectedDataPoints": "2", "errorMessage": "…"}}`, which becomes a `partial-success` diagnostic with `signal: 'metrics'`.
