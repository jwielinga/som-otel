# Release Setup

Releases are created by semantic-release after a quality check on `main`. Conventional Commit messages determine the next version. The release workflow publishes `som-otel` to npm through GitHub Actions Trusted Publishing; it does not use a stored npm token. semantic-release updates package version metadata, then invokes npm CLI directly for publication because the semantic-release npm plugin's token verification is not OIDC-compatible.

## One-Time Setup

1. Create the public GitHub repository named `som-otel` under its intended owner. The `origin` remote and the `repository` field in `package.json` already point at `https://github.com/jwielinga/som-otel.git`; change both if the owner differs.
2. Publish the package once by hand, because npm only lets you attach a Trusted Publisher to a package that already exists. From a clean checkout of `main` run `pnpm install --frozen-lockfile && pnpm build`, set the version with `npm version 0.0.1 --no-git-tag-version`, and run `npm publish --access public` with your own npm account and 2FA. Discard the version change afterwards (`git checkout package.json`). The existing `v1.0.0` to `v1.3.0` Git tags were never published to npm, so semantic-release continues from them and the first real release will be 1.x.
3. In the npm package settings, add a GitHub Actions Trusted Publisher for the repository owner, repository `som-otel`, workflow `.github/workflows/release.yml`, and environment `release`. Do not create an `NPM_TOKEN` secret. The release job uses the Node LTS version pinned in `.nvmrc`, whose bundled npm supports Trusted Publishing and provenance.
4. Under Settings > Environments, create an environment named `release`. Limit deployment branches to `main` and, when another maintainer is available, add required reviewers. The release job declares this environment, so only runs from `main` can obtain the OIDC token that npm accepts. Keep any future release secrets in this environment, not at repository level.
5. Set the repository's default branch to `main`. Under Settings > Actions > General, restrict workflow permissions to read-only by default and allow only the actions this project uses.
6. Add a branch ruleset for `main`: require pull requests, require the `Quality / quality` status check, block force pushes and branch deletion, and prevent bypass where practical. Require at least one approval when another maintainer is available.
7. Enable private vulnerability reporting, secret scanning and push protection, Dependabot alerts, and Dependabot security updates in repository settings. Confirm workflow files and `SECURITY.md` are visible after the repository becomes public.
8. For the documentation site, open Settings > Pages and set **Source** to **GitHub Actions**. The Docs workflow (`.github/workflows/docs.yml`) then builds `website/` and deploys it to `https://jwielinga.github.io/som-otel/` on every push to `main` that changes `docs/` or `website/`. If the owner or repository name changes, update `url`, `baseUrl`, `organizationName`, and `projectName` in `website/docusaurus.config.ts`. The deploy job is the only one with `pages: write`; pull requests only build the site.

## Release Behavior

The release workflow runs only on pushes to `main` and waits for the reusable Quality workflow. A `fix:` commit triggers a patch release; `feat:` triggers a minor release; a breaking-change marker triggers a major release. Commits with other types do not release. Do not manually edit `package.json`'s version; semantic-release owns published versions and Git tags.

The first release has no prior semantic-release tag to use as a baseline, so review the existing Conventional Commit history before merging the first release-triggering change. Keep `main` protected so unreviewed changes cannot alter the publishing workflow.

## Pull Request Security

The Quality workflow uses `pull_request`, requests only `contents: read`, and disables persisted checkout credentials. It does not reference repository secrets; fork pull requests do not receive secrets. The Bundle size workflow also uses `pull_request` and is the only other workflow that requests write access: `pull-requests: write`, solely to post its size comment. It never gets `id-token: write`, and fork pull requests only get the job summary because their token is read-only. Do not add repository-level secrets: contributors with write access can change workflow files in same-repository pull requests. If a future workflow needs credentials, use a protected environment with required reviewers. The release workflow is the only workflow with `id-token: write`, and it runs only from `main`; never move that permission to a pull-request workflow or use `pull_request_target` to execute contributor code.
