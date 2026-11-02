---
sidebar_position: 12
title: Collector setup
---

# Collector setup

Som talks to any server that implements the OTLP/HTTP logs endpoint, and the traces endpoint if you use [tracing](./tracing.md), with JSON payloads. This page covers what that server needs, with the OpenTelemetry Collector as the worked example.

## Requirements

- An endpoint that accepts `POST` requests with an OTLP/JSON `ExportLogsServiceRequest` body. The conventional path is `/v1/logs`, and Som posts to exactly the URL you configure.
- For spans, an endpoint that accepts an `ExportTraceServiceRequest` body, conventionally `/v1/traces`. See [Traces](#traces).
- HTTPS in production.
- A **CORS policy** that allows your site, because the browser sends the request cross-origin.
- Support for `Content-Encoding: gzip` if you turn on [compression](./compression.md).

Som sends these headers, plus any [`headers`](./configuration.md#request-headers) you configure:

| Header             | Value                               |
| ------------------ | ----------------------------------- |
| `Content-Type`     | `application/json`                  |
| `Content-Encoding` | `gzip`, only when compression is on |

## CORS

For a cross-origin request with a `Content-Type: application/json` body, the browser first sends an `OPTIONS` preflight. The collector must answer it, allowing:

- your application's **origin**,
- the actual request method, `POST` (the preflight itself uses `OPTIONS`),
- the request headers Som sends: `Content-Type`, `Content-Encoding` when compressing, and any custom headers such as `Authorization`.

If CORS is wrong, the browser blocks the request and Som sees a network error. In the console you will see a CORS message. Som retries it as a network failure, then rejects with the browser's original error message.

## OpenTelemetry Collector example

```yaml title="otel-collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - https://app.example.com
          allowed_headers:
            - Content-Type
            - Content-Encoding
            - Authorization

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [debug]
    traces:
      receivers: [otlp]
      exporters: [debug]
```

With this configuration, set Som's `endpoint` to `https://<collector-host>:4318/v1/logs`. Replace the `debug` exporter with the exporter for your backend.

For local development you can allow `http://localhost:*` origins, for example `allowed_origins: ['http://localhost:5173']`.

## Traces

The same OTLP/HTTP receiver serves traces at `/v1/traces`. Add a `traces` pipeline as shown above and Som's [derived traces endpoint](./tracing.md#traces-endpoint) matches it. CORS, headers, compression, and authentication work the same as for logs. If you send spans to a different URL, set `tracesEndpoint`.

## Authentication

Browser code cannot keep secrets. Prefer one of:

- A collector or gateway on your own domain that accepts logs without credentials and applies rate limits.
- Short-lived, narrowly scoped tokens issued per session and sent through `headers`.

Remember that custom headers force a preflight, and that the browser may not finish a preflight during page unload.

## Collector versions

Som is tested against a real OpenTelemetry Collector (see [Contributing](../contributing.md#test-against-a-real-collector)). Collector `0.130.0` and `0.140.0` accept and forward everything Som sends. Collector `0.120.0` accepts it too, but silently drops the log record `eventName` field, which it does not know yet. Use a recent collector if you rely on [`eventName`](./trace-correlation.md#per-call-trace-fields).

## Troubleshooting

| Symptom                                       | Likely cause                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Nothing arrives, CORS error in the console    | The collector does not allow your origin or a header Som sends.                               |
| `OTLP log request failed: 404`                | Wrong `endpoint`. Som does not append `/v1/logs`.                                             |
| `OTLP trace request failed: 404`              | Wrong `tracesEndpoint`, or no traces pipeline or receiver on the collector.                   |
| `OTLP log request failed: 400`                | The collector rejected the payload. Check the body and attribute values.                      |
| `OTLP log request failed: 415`                | The receiver does not accept JSON. Enable the OTLP/HTTP receiver.                             |
| Compression enabled and requests fail         | The collector or a proxy does not accept `Content-Encoding: gzip`, or CORS blocks the header. |
| Some logs missing after a successful response | Check for `partial-success` [diagnostics](./diagnostics.md).                                  |
