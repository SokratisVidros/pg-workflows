# Shared Release Process

This is the single source of truth for deterministic releases in this repository.

## Scope

- One release run covers **every publishable package** under `packages/*` (any `package.json` without `"private": true`). Packages with no changes since their last release are **skipped**.
- Release artifacts:
  - bumped `package.json` version for each released package
  - `bun.lock` (refreshed after the version bumps)
  - one `CHANGELOG.md` entry per released package
  - one release commit covering all released packages
  - one annotated git tag per released package
  - one GitHub release per released package
- Do **not** publish to npm unless the user explicitly asks

## Versioning Scheme

Packages are versioned **independently**. Each package has its own semver line and is bumped only when it changed. There is no shared version number.

- Cross-package compatibility is expressed through peer ranges (e.g. `"pg-workflows": ">=0.16.0"`), not matching versions.
- A package that needs a new engine API raises its `pg-workflows` peer floor in the same PR that uses the API.

Current packages, in release (and publish) order. `pg-workflows` always goes first because the others peer on it:

| Directory               | npm name             | Peers on       |
| ----------------------- | -------------------- | -------------- |
| `packages/pg-workflows` | `pg-workflows`       | —              |
| `packages/otel`         | `@pg-workflows/otel` | `pg-workflows` |
| `packages/ui`           | `@pg-workflows/ui`   | `pg-workflows` |

New publishable packages join automatically. Put them after `pg-workflows`, sorted by directory name.

## Deterministic Conventions

- **Tag format:** `<npm name>@X.Y.Z` (e.g. `pg-workflows@0.16.0`, `@pg-workflows/otel@0.1.0`)
- **Legacy tags:** engine releases up to `v0.15.0` used `vX.Y.Z`. Treat the latest `v*` tag as the engine's previous tag when no `pg-workflows@*` tag exists yet.
- **Release commit title:** `Release <tag>[, <tag>...]` in release order (e.g. `Release pg-workflows@0.16.0, @pg-workflows/otel@0.1.0`)
- **Tag annotation message:** `Release <tag>`
- **Changelog heading:** `## <tag> - YYYY-MM-DD`
- **Release date format:** `YYYY-MM-DD` (UTC/local current date, consistent within the release)

## Required Files

- `packages/*/package.json` of each released package
- `bun.lock`
- `CHANGELOG.md` (create if missing)

## Workflow

Copy this checklist and execute in order:

```text
Release checklist:
- [ ] 1) Inspect repo and verify release baseline
- [ ] 2) Find each package's previous tag and detect changed packages
- [ ] 3) Collect key changes per changed package
- [ ] 4) Decide bump level per package and bump versions
- [ ] 5) Check cross-package peer ranges
- [ ] 6) Update/create CHANGELOG.md with deterministic format
- [ ] 7) Commit only release files with deterministic message
- [ ] 8) Create one annotated tag per released package
- [ ] 9) Push commit + tags
- [ ] 10) Create one GitHub release per released package
- [ ] 11) Stop and tell user the publish commands
```

### 1) Inspect repo and baseline

Run:

```bash
git fetch --tags origin
git status --short --branch
git tag --sort=-creatordate | head -n 20
```

Rules:

- Release from an up-to-date `main`.
- If there are unrelated dirty changes, stop and ask the user how to proceed.
- Releasing from a dirty tree is only acceptable when the dirty files are exactly release files and intentional.

### 2) Previous tags and change detection

For each publishable package (`DIR`, `NAME` from its `package.json`):

```bash
PREV_TAG=$(git tag --list "$NAME@*" --sort=-version:refname | head -n 1)
# Engine only: fall back to the legacy scheme
[ -z "$PREV_TAG" ] && [ "$NAME" = "pg-workflows" ] && PREV_TAG=$(git tag --list 'v*' --sort=-version:refname | head -n 1)
```

- **Has `PREV_TAG`:** the package changed if files it ships differ. Test-only changes don't count:

  ```bash
  git diff --quiet "$PREV_TAG" HEAD -- "$DIR" \
    ":(exclude,glob)$DIR/**/*.test.ts" ":(exclude,glob)$DIR/**/tests/**" \
    || echo "$NAME changed"
  ```

  Unchanged packages are skipped: no bump, no changelog entry, no tag.

- **No `PREV_TAG` (first release):** check the registry with `npm view "$NAME@$(node -p "require('./$DIR/package.json').version")" version`.
  - If the version is **not** on npm, release the package at its current `package.json` version **without bumping**.
  - If it **is** on npm, stop and ask the user.

If no package changed, stop and tell the user there is nothing to release.

### 3) Collect key changes

For each changed package, collect the commits that touched it:

```bash
git log --reverse --pretty=format:'%h %s' "${PREV_TAG}..HEAD" -- "$DIR"
```

For a first release, summarise what the package provides instead.

Build concise user-facing bullets grouped into:

- `Added` (new features and APIs)
- `Fixed` (bug fixes)
- `Documentation` (docs/readme/reorg changes)
- `Changed` (other meaningful behavior/architecture updates). Prefix breaking changes with `**BREAKING —**` and include the migration.

Skip noise-only items unless they matter to users. A commit that touches several packages contributes a bullet to each, worded for that package.

### 4) Bump versions

Per changed package (skip first releases, which keep their version):

- `minor` if it has any `Added` or `Changed` bullet, including breaking changes. The packages are pre-1.0. After 1.0, breaking changes are `major`.
- `patch` if it has only `Fixed` / `Documentation` bullets.
- The user may override the level for any package.

```bash
npm version <minor|patch> --no-git-tag-version --prefix "$DIR"
bun install
```

Capture each package's `NEW_VERSION` and `NEW_TAG="$NAME@$NEW_VERSION"`. Confirm `bun.lock` is up to date and only the released packages' versions changed.

### 5) Check cross-package peer ranges

For each released package that peers on `pg-workflows`, the peer floor must be satisfied by the engine version after this release. That's the new version if the engine is released in this run, otherwise its current version:

```bash
node -p "require('./packages/otel/package.json').peerDependencies['pg-workflows']"
```

If a floor points above that version (e.g. `>=0.16.0` while the engine only gets a patch to `0.15.1`), stop and ask. Usually the engine bump should be `minor`.

### 6) Update `CHANGELOG.md`

If missing, create with:

```markdown
# Changelog

All notable changes to this project will be documented in this file.
```

Insert one entry per released package at the top, in release order:

```markdown
## pg-workflows@X.Y.Z - YYYY-MM-DD

### Added
- ...

### Fixed
- ...

### Documentation
- ...

### Changed
- ...

[pg-workflows@X.Y.Z]: https://github.com/SokratisVidros/pg-workflows/compare/<PREV_TAG>...pg-workflows@X.Y.Z
```

Link encoding: in compare/tree URLs, write `@pg-workflows/otel@0.1.0` as `%40pg-workflows/otel%400.1.0`.

For a first release, open with `Initial release.` and link the tree instead:

```markdown
[@pg-workflows/otel@0.1.0]: https://github.com/SokratisVidros/pg-workflows/tree/%40pg-workflows/otel%400.1.0/packages/otel
```

Changelog rules:

- Keep section order: `Added`, `Fixed`, `Documentation`, `Changed`
- Omit empty sections instead of leaving placeholders
- Keep bullets short and user-centric
- Add a comparison (or tree) link for every released package

### 7) Create deterministic release commit

Stage only the release files:

```bash
git add bun.lock CHANGELOG.md packages/<released>/package.json ...
```

Commit format (use HEREDOC):

```bash
git commit -m "$(cat <<'EOF'
Release pg-workflows@X.Y.Z, @pg-workflows/otel@A.B.C

Align package metadata with the new release versions and document the key user-facing changes per package in a deterministic changelog format.
EOF
)"
```

### 8) Create deterministic tags

One per released package:

```bash
git tag -a "pg-workflows@X.Y.Z" -m "Release pg-workflows@X.Y.Z"
git tag -a "@pg-workflows/otel@A.B.C" -m "Release @pg-workflows/otel@A.B.C"
```

If any tag already exists, stop and ask the user.

### 9) Push commit and tags

```bash
git push origin main
git push origin "pg-workflows@X.Y.Z" "@pg-workflows/otel@A.B.C"
```

### 10) Create GitHub releases

One release per tag, in release order. Notes follow a deterministic shape:

```markdown
## Key changes
- ...
- ...

## Changelog
See `CHANGELOG.md` for full release notes.
```

Command pattern:

- The engine release is marked latest.
- Other packages pass `--latest=false`, so the repo's "Latest" badge always points at the engine.
- If the engine is skipped, pass `--latest=false` for every release.

```bash
gh release create "pg-workflows@X.Y.Z" --title "pg-workflows@X.Y.Z" --latest --notes "<notes>"
gh release create "@pg-workflows/otel@A.B.C" --title "@pg-workflows/otel@A.B.C" --latest=false --notes "<notes>"
```

### 11) Final handoff

Always end with:

- release commit SHA
- created tags, plus the packages skipped as unchanged
- GitHub release URLs
- reminder that publishing is intentionally not run

Use `bun publish`, not `npm publish`: it rewrites the `catalog:` and `workspace:` protocols into real version ranges. Each package's `prepublishOnly` runs `scripts/assert-bun-publish.mjs`, which refuses `npm publish` from a package folder. If bun's browser login fails, pack with `bun pm pack` and publish the tarball with `npm publish <tarball> --access public`, which asks for the one-time password. Publish in release order, so the engine reaches npm before the packages that peer on it. List only the released packages:

```text
Release prepared. Final step for you, in order:
(cd packages/pg-workflows && bun publish)
(cd packages/otel && bun publish)
```
