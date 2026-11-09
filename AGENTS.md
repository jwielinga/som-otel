# Agent Guidance

## Project Scope

Som is a browser-first TypeScript npm package for sending OpenTelemetry logs, spans, and metrics to an OTLP/HTTP collector. This repository is a library, not a UI application. Do not add app pages, UI components, or demo-site scaffolding unless requested.

The package is prepared for public npm releases as `som-otel`. Releases run through semantic-release on `main` after the repository's npm Trusted Publisher and branch protection are configured.

## Implementation

- Public exports live in `src/index.ts`.
- `src/` layout: `core/` (`createSom`, `Som`), `logs/`, `traces/`, `metrics/`, `otlp/` (encoding, partial success), `transport/` (transport, exporter, batcher, retry), `utils/`, `integration/` (cross-module tests), `test-support/`. Tests sit next to their source.
- All types live in `src/types.ts`. Constants live in `<folder>/<folder>.constants.ts`; the `OTel*` const+type pairs stay together in `otlp/otlp.constants.ts`.
- Keep the API focused on logs, traces, and metrics. Use the vocabulary in `GLOSSARY.md` and respect `docs/adr/`.
- `createSom` returns `{ logger, tracer, meter, flush, shutdown }` and `createSomLogger` stays logs-only. All signals share one export pipeline (`OtlpTransport`, `LogBatcher`) with separate queues and endpoints.
- `SomLogger` batches records into OTLP/HTTP JSON requests, flushing at 20 records or after 5 seconds by default; `batch` options override these thresholds. Spans are queued when `span.end()` is called, and `end()` never throws.
- Non-success HTTP responses reject each affected log promise.
- Preserve OTLP log severity and resource fields when changing serialization, and the OTLP span fields (ids, flags, kind, status, dropped counts) for spans.
- Update tests and README when public API behavior changes.
- Update the guides in `docs/` (Docusaurus pages) when public API or behavior changes. `website/` only holds the Docusaurus app; write documentation in `docs/`.

## Development

- Use pnpm for package management.
- Run `pnpm check` before considering changes complete.
- When you change `docs/` or `website/`, also run `pnpm docs:build`; broken links fail the build. The Docs workflow publishes the site to GitHub Pages from `main`.
- Inject `fetcher` in tests; do not require a live collector for unit tests. The only tests that need one are `*.collector.test.ts`; they need Docker and run with `pnpm test:collector`, not in `pnpm check`.
