# Som + Grafana + Loki + Prometheus

Browser logs and metrics flow from Som to Grafana Alloy over OTLP/HTTP. Alloy forwards logs to Loki's native OTLP endpoint, and metrics to Prometheus's native OTLP receiver. Grafana provisions three dashboards: **Browser Logs**, **Error Overview**, and **Browser Metrics**.

Som sends metrics with delta temporality, which Prometheus rejects, so Alloy converts them to cumulative with `otelcol.processor.deltatocumulative`. Spans from the demo page reach Alloy on `/v1/traces` and are discarded by the debug exporter; there is no trace backend in this stack, and Tempo would be the next step. Alloy runs with `--stability.level=experimental` because the delta conversion and the debug exporter are experimental there.

## Run

From this directory:

```sh
docker compose up --build
```

Open the sample app at <http://localhost:8080>. It has three tabs, one per signal:

- **Logs:** buttons that send React todo-list themed debug, info, warning, error, and fatal events. Each button waits for the export request to succeed, and a second list polls Loki for what it stored.
- **Metrics:** buttons that record a counter, an up-down counter, a gauge and a histogram. A second list polls Prometheus for the stored series.
- **Traces:** buttons that send a nested checkout trace and a failing trace. Spans are discarded by Alloy's debug exporter, so read them with `docker compose logs alloy`.

Metric and trace buttons flush after each action and show whether the export worked. The "How to use the logger" panel at the bottom of the page shows the Som calls behind them. The page reaches Loki and Prometheus through the dev server's `/loki` and `/prometheus` proxies.

- Grafana: <http://localhost:3000> (`admin` / `som-demo-only`)
- Browser Logs dashboard: <http://localhost:3000/d/som-browser-logs/browser-logs>
- Error Overview dashboard: <http://localhost:3000/d/som-error-overview/error-overview>
- Alloy OTLP/HTTP receiver: <http://localhost:4318/v1/logs>
- Loki API: <http://localhost:3100>
- Prometheus: <http://localhost:9090>
- Browser Metrics dashboard: <http://localhost:3000/d/som-browser-metrics/browser-metrics>

## Verify ingestion

With the stack running, execute:

```sh
./smoke-test.sh
```

The script posts a uniquely marked OTLP log to Alloy, then queries Loki until that exact log is returned. It then posts a delta Sum to Alloy's `/v1/metrics` and queries Prometheus until the series with that marker is returned. A successful response proves ingestion and storage, not just that the receiver is reachable.

The browser app sends real requests through Som and uses the same Alloy receiver. Browser requests are allowed only from `http://localhost:8080` by the local CORS config.

## Stop

```sh
docker compose down
```

Remove the local Grafana, Loki, and Prometheus data volumes too:

```sh
docker compose down --volumes
```

This stack is for local development only. It has no authentication on Alloy, Loki, or Prometheus, and its Grafana password is intentionally fixed; do not expose these ports to an untrusted network.
