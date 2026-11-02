# Contributing

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

Use nvm to install and select the Node.js version pinned in `.nvmrc`; use pnpm 8.6.12 for development. Install dependencies and run the full quality check before opening a pull request:

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm check
```

Pull requests should target `main`. The Quality workflow runs formatting, lint, type, test, build, and package checks (`pnpm pack:check`). The Bundle size workflow comments on each pull request with how the gzip size of the build changed. Do not include collector credentials, access tokens, or real user log data in commits, tests, or issues.

## Commit Messages

Use Conventional Commits because semantic-release derives package versions and release notes from commit history:

- `fix: handle empty batch` produces a patch release.
- `feat: add resource attributes` produces a minor release.
- `feat!: change logger configuration` or a `BREAKING CHANGE:` footer produces a major release.

Documentation-only and maintenance changes can use `docs:`, `test:`, `build:`, or `chore:`; those do not publish a release by themselves.

## Documentation

The user documentation lives in `docs/` as Markdown and is rendered by the Docusaurus app in `website/`. Update the matching page whenever public API or behavior changes. To preview and verify:

```sh
pnpm --dir website install --frozen-lockfile
pnpm docs:start
pnpm docs:build
```

`pnpm docs:build` fails on broken links. The Docs workflow builds the site on pull requests and publishes it to GitHub Pages from `main`.
