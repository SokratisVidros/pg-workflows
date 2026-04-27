# Changelog

All notable changes to this project will be documented in this file.

## v0.9.0 - 2026-04-27

### Added

- Raised the `resource_id` and `workflow_id` column limit from 32 to 256 characters (schema v3) and added early input validation so callers see a clear error instead of a database failure.

### Fixed

- Recovered stuck workflow runs by routing failed or expired jobs through a dedicated pg-boss dead-letter queue (`workflow_run_dlq`); orphaned runs are now retried with the engine's exponential backoff or marked `FAILED` once retries are exhausted instead of staying `RUNNING` forever.
- Detected dead workers faster via a configurable pg-boss heartbeat (`WORKFLOW_RUN_HEARTBEAT_SECONDS`, default 30s), so crashed workers surface in roughly a minute instead of waiting for the full job expiration window.

## v0.8.3 - 2026-04-22

### Fixed

- Upgraded `pg-boss` to `^12.16.0` to fix a bug where `start()` could silently leave the queue cache uninitialized, poisoning the boss instance for its entire lifetime ([timgit/pg-boss#768](https://github.com/timgit/pg-boss/issues/768)).

## v0.8.2 - 2026-04-16

### Added

- Allowed `WorkflowClientOptions` to accept a pre-configured `pg-boss` instance so clients can reuse existing queue configuration.

## v0.8.1 - 2026-04-15

### Added

- Exposed `idempotencyKey` on `WorkflowClient.startWorkflow()` to support safer client-side deduplication when starting runs.

### Changed

- Added a deterministic release skill so version bumps, changelog updates, tags, and GitHub releases follow a single repeatable process.

## v0.8.0 - 2026-04-15

### Added

- Added a dedicated `WorkflowClient` API and `WorkflowRef` support to separate client-side workflow operations from worker runtime concerns.
- Added a microservices example that demonstrates shared workflow definitions with distinct API and worker services.

### Fixed

- Improved workflow failure handling to surface all underlying errors instead of masking nested causes.

### Documentation

- Split the README into focused documentation pages under `docs/` to make architecture, configuration, API usage, and examples easier to navigate.

[v0.8.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.7.2...v0.8.0
[v0.8.1]: https://github.com/SokratisVidros/pg-workflows/compare/v0.8.0...v0.8.1
[v0.8.2]: https://github.com/SokratisVidros/pg-workflows/compare/v0.8.1...v0.8.2
[v0.8.3]: https://github.com/SokratisVidros/pg-workflows/compare/v0.8.2...v0.8.3
[v0.9.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.8.3...v0.9.0
