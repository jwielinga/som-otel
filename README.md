# Som

Som is a lightweight browser-side TypeScript npm package for sending OpenTelemetry logs and spans to an OTLP/HTTP collector. It is meant to provide a simple, elegant solution to debug sessions on your web app. It is not for tracking user behaviour or for marketing purposes.

## Quick Start

```ts
import { createSomLogger } from 'som-otel'

const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'web-app',
  serviceVersion: '1.0.0',
})

await logger.info('User signed in', { userId: 'user-123' })
```

Som batches logs by default and sends them when it has 20 records or after 5 seconds. Configure `batch.maxBatchSize` and `batch.scheduledDelayMs` to change these thresholds.

To send spans as well, use `createSom`. It returns a logger and a tracer; spans go to `/v1/traces` next to your `/v1/logs` endpoint, or to `tracesEndpoint`:

```ts
import { createSom } from 'som-otel'

const { logger, tracer } = createSom({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'web-app',
})

await tracer.trace('checkout', async (span) => {
  await logger.info('Charging card', { orderId: 'order-42' }, { span })
})
```

Som sets the Fetch `keepalive` flag on requests by default so logs can finish sending during page unload; set `keepalive: false` to disable it. Browsers without support ignore it. Som also flushes queued logs on `pagehide` and when the page is hidden.

Failed exports are retried (network errors, timeouts, and HTTP 429/502/503/504, honoring `Retry-After`) with a 10-second per-request timeout. Set `onDiagnostic` to observe export failures, partial success, and dropped records.

Log `Error` objects directly, add trace correlation with `traceContext` or per-call options, and choose gzip compression, instrumentation scope, schema URLs, and attribute limits. Som adds browser resource attributes by default; set `detectResource: false` to turn that off.

See the [documentation site](https://jwielinga.github.io/som-otel/) for installation, configuration, every option, browser CORS, error handling, and current limits. The Markdown sources are in [docs](docs).

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and commit conventions, and [RELEASING.md](RELEASING.md) for the one-time GitHub and npm setup.

## Development

Use Node.js via nvm, pinned to `.nvmrc`:

```sh
nvm install
nvm use
pnpm install
```

Run checks individually or all at once:

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm check
```

The documentation site is a Docusaurus project in `website/` that renders the Markdown in `docs/`. It has its own dependencies:

```sh
pnpm --dir website install
pnpm docs:start   # live preview
pnpm docs:build   # production build into website/build
```

## License

Som is licensed under EUPL-1.2. See [LICENSE.txt](LICENSE.txt).
