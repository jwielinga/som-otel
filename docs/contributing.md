---
sidebar_position: 3
title: Contributing
---

# Contributing

## Set up the repository

Use the Node.js version pinned in `.nvmrc` and pnpm version declared by the repository:

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
```

## Make and verify changes

Keep changes focused. Add or update tests when changing behavior; tests inject a `fetcher` and do not need a live collector.

Run the complete quality suite before opening a pull request:

```sh
pnpm check
```

This runs formatting, lint, type checking, tests, and the production package build. Individual commands are available as `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

For documentation changes, edit Markdown or MDX under `docs/`. The Docusaurus app in `website/` renders those source files; do not edit generated output in `website/build/`. Install its dependencies and preview or validate the site with:

```sh
pnpm --dir website install --frozen-lockfile
pnpm docs:start
pnpm docs:build
```

The docs workflow also runs `pnpm typecheck` in `website/` before building.

### Test against a real collector

`pnpm test` never needs a collector. To check that a real OpenTelemetry Collector accepts and forwards what Som sends, run the opt-in suite. It needs Docker and starts a collector container itself:

```sh
pnpm test:collector
# another collector version:
SOM_COLLECTOR_IMAGE=otel/opentelemetry-collector:0.130.0 pnpm test:collector
```

## Open a pull request

Target `main`. The Quality workflow runs on pull requests and must pass. Use Conventional Commit messages because semantic-release uses commit history to determine releases:

- `fix: handle empty batch` for a bug fix.
- `feat: add resource attributes` for a backward-compatible feature.
- `feat!: change logger configuration` or a `BREAKING CHANGE:` footer for a breaking change.
- `docs: clarify collector setup` or `chore: update tooling` for changes that do not publish a release.

Do not include collector credentials, access tokens, or real user log data in commits, tests, or issues. See the [Security Policy](https://github.com/jwielinga/som-otel/blob/main/SECURITY.md) for vulnerability reports and [Release Setup](https://github.com/jwielinga/som-otel/blob/main/RELEASING.md) for maintainer release configuration.
