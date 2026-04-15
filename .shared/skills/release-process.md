# Shared Release Process

This is the single source of truth for deterministic releases in this repository.

## Scope

- Release type: **minor** by default
- Release artifacts:
  - `package.json` version
  - `package-lock.json` version
  - `CHANGELOG.md` release entry
  - one release commit
  - one annotated git tag
  - one GitHub release
- Do **not** run `npm publish` unless the user explicitly asks

## Deterministic Conventions

- **Version tag format:** `vX.Y.Z`
- **Release commit title:** `Release vX.Y.Z`
- **Tag annotation message:** `Release vX.Y.Z`
- **Changelog heading:** `## vX.Y.Z - YYYY-MM-DD`
- **Release date format:** `YYYY-MM-DD` (UTC/local current date, consistent within the release)

## Required Files

- `package.json`
- `package-lock.json`
- `CHANGELOG.md` (create if missing)

## Workflow

Copy this checklist and execute in order:

```text
Release checklist:
- [ ] 1) Inspect repo and verify release baseline
- [ ] 2) Compute previous tag and next minor version
- [ ] 3) Collect key changes since previous tag
- [ ] 4) Bump version in package files
- [ ] 5) Update/create CHANGELOG.md with deterministic format
- [ ] 6) Commit only release files with deterministic message
- [ ] 7) Create deterministic annotated tag
- [ ] 8) Push commit + tag
- [ ] 9) Create GitHub release with deterministic notes
- [ ] 10) Stop and tell user to run npm publish
```

### 1) Inspect repo and baseline

Run:

```bash
git status --short --branch
git tag --sort=-version:refname | head -n 20
```

Rules:

- If there are unrelated dirty changes, stop and ask the user how to proceed.
- Releasing from a dirty tree is only acceptable when the dirty files are exactly release files and intentional.

### 2) Compute previous tag and next version

Use latest semver tag as `PREV_TAG` (for example `v0.8.0`).

Compute next minor version from `package.json`:

```bash
npm version minor --no-git-tag-version
```

Capture `NEW_VERSION` from `package.json` and `NEW_TAG="v$NEW_VERSION"`.

### 3) Collect key changes

Collect commits since previous tag:

```bash
git log --reverse --pretty=format:'%h %s' "${PREV_TAG}..HEAD"
```

Build concise user-facing bullets grouped into:

- `Added` (typically `feat:`)
- `Fixed` (typically `fix:`)
- `Documentation` (docs/readme/reorg changes)
- `Changed` (other meaningful behavior/architecture updates)

Skip noise-only items unless they matter to users.

### 4) Bump version files

After `npm version minor --no-git-tag-version`, ensure:

- `package.json` has `NEW_VERSION`
- `package-lock.json` has `NEW_VERSION`

### 5) Update `CHANGELOG.md`

If missing, create with:

```markdown
# Changelog

All notable changes to this project will be documented in this file.
```

Insert new entry at the top:

```markdown
## vX.Y.Z - YYYY-MM-DD

### Added
- ...

### Fixed
- ...

### Documentation
- ...

### Changed
- ...

[vX.Y.Z]: https://github.com/<owner>/<repo>/compare/vA.B.C...vX.Y.Z
```

Changelog rules:

- Keep section order: `Added`, `Fixed`, `Documentation`, `Changed`
- Omit empty sections instead of leaving placeholders
- Keep bullets short and user-centric
- Add/update comparison link for the new version

### 6) Create deterministic release commit

Stage only:

```bash
git add package.json package-lock.json CHANGELOG.md
```

Commit format (use HEREDOC):

```bash
git commit -m "$(cat <<'EOF'
Release vX.Y.Z

Align package metadata with the new release version and document the key user-facing changes since vA.B.C in a deterministic changelog format.
EOF
)"
```

### 7) Create deterministic tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

If tag already exists, stop and ask the user.

### 8) Push commit and tag

```bash
git push origin main
git push origin vX.Y.Z
```

### 9) Create GitHub release

Create release notes in a deterministic shape:

```markdown
## Key changes
- ...
- ...

## Changelog
See `CHANGELOG.md` for full release notes.
```

Command pattern:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "<notes>"
```

### 10) Final handoff

Always end with:

- release commit SHA
- created tag
- GitHub release URL
- reminder that `npm publish` is intentionally not run

Use exact guidance:

```text
Release prepared. Final step for you: npm publish
```
