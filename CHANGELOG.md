# Changelog

All notable changes to this project will be documented in this file.

## v0.14.0 - 2026-06-23

### Added

- Added workflow run priorities backed by pg-boss's native job priority (higher runs first; `normal` = 0) ([#43](https://github.com/SokratisVidros/pg-workflows/pull/43)). Set a default on the workflow definition or override per run via `startWorkflow` options using named levels (`high`, `normal`, `low`) or a raw integer. Priority is resolved once at run creation, persisted on the `workflow_runs` row (schema v6), reused on every re-enqueue (resume, retry, poll/waitUntil continuations, scheduled fires), and inherited by child workflows unless overridden.

[v0.14.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.13.2...v0.14.0

## v0.13.2 - 2026-06-16

### Fixed

- Installation now fails fast with a clear error when a `workflow_runs` table already exists in the schema but was not created by pg-workflows, preventing accidental corruption of an unrelated table ([#40](https://github.com/SokratisVidros/pg-workflows/pull/40)).
- Migrations now detect mismatched partial schema state (`workflow_runs` and `workflow_schema_version` existing without the other) and surface a clear error instead of proceeding.

### Changed

- Internal engine refactoring to couple step methods to step types and tighten child-workflow run typing ([#40](https://github.com/SokratisVidros/pg-workflows/pull/40)).

[v0.13.2]: https://github.com/SokratisVidros/pg-workflows/compare/v0.13.1...v0.13.2

## v0.13.1 - 2026-06-15

### Fixed

- Cleared the internal `unregisteredWorkflows` map after the registration loop in `engine.start()`, preventing workflows passed at construction from being re-registered on subsequent `start()` calls ([#39](https://github.com/SokratisVidros/pg-workflows/pull/39)).

[v0.13.1]: https://github.com/SokratisVidros/pg-workflows/compare/v0.13.0...v0.13.1

## v0.13.0 - 2026-06-03

### Added

- Added recurring workflow schedules via a new `schedule` option on `workflow()` ([#7](https://github.com/SokratisVidros/pg-workflows/pull/7), closes [#7](https://github.com/SokratisVidros/pg-workflows/issues/7)). Accepts a cron expression, a `parse-duration` string (e.g. `'5m'`, `'1 hour'`), or a `DurationObject`; non-cron values are auto-translated to cron only when the interval divides cleanly. Schedules register with pg-boss on `engine.start()`, unregister on stop/unregister, and stamp the fire time into the new `workflow_runs.scheduled_for` column. A top-level `timezone` option is supported for cron expressions.
- Added `ctx.schedule.timestamp` on the workflow context for schedule-triggered runs; manual `engine.startWorkflow()` runs leave `ctx.schedule` undefined so handlers can branch on the trigger source.
- Added `engine.getWorkflowLastRun({ workflowId, resourceId? })` which returns the most recent run for a workflow — useful as a cursor for incremental syncs without denormalizing previous-run state into context.

[v0.13.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.12.0...v0.13.0

## v0.12.0 - 2026-05-26

### Added

- Added first-party OpenTelemetry instrumentation via `otelPlugin()` ([#36](https://github.com/SokratisVidros/pg-workflows/pull/36), closes [#34](https://github.com/SokratisVidros/pg-workflows/issues/34)). Each worker execution emits one `pg_workflows.workflow.run` span with child spans per step kind (`step.run`, `step.waitFor`, `step.pause`, `step.waitUntil`, `step.invokeChildWorkflow`); spans replayed from the step cache are suppressed and errors are recorded on the span. `@opentelemetry/api` is an optional peer dependency.
- Extended `WorkflowPlugin` with an optional `wrap` hook and exposed `resourceId` and `attempt` on `WorkflowContext` so plugins can compose middleware around the workflow handler with full execution context.

## v0.11.0 - 2026-05-26

### Fixed

- Kept `context.timeline` live across steps within a handler invocation so workflow authors observe outputs from just-completed steps instead of a stale snapshot taken at handler entry ([#35](https://github.com/SokratisVidros/pg-workflows/pull/35), fixes [#14](https://github.com/SokratisVidros/pg-workflows/issues/14)).

### Documentation

- Consolidated agent instructions into a single `AGENTS.md` as the source of truth for AI coding agents, with `CLAUDE.md` and `GEMINI.md` as symlinks.
- Added the OpenTelemetry instrumentation design and implementation plan for [#34](https://github.com/SokratisVidros/pg-workflows/issues/34).

### Changed

- **BREAKING — curated public exports ([#37](https://github.com/SokratisVidros/pg-workflows/pull/37)):** replaced blanket `export *` re-exports with an explicit public surface. The following are no longer importable from `pg-workflows` or `pg-workflows/client`: `parseDuration`, `validate*` helpers, the `StepType` enum, and the internal types `StepInternalDefinition`, `WorkflowInternalDefinition`, `WorkflowInternal*Logger*`, `WorkflowFactory`, and `DurationObject`. `WorkflowRun` is now exported from the main entry, and the `pg-workflows/client` entry exposes the error classes and the start-workflow options type.
- **BREAKING — renamed `WorkflowRunOptions` to `StartWorkflowOptions` ([#38](https://github.com/SokratisVidros/pg-workflows/pull/38)):** the type is now aligned with the `startWorkflow()` method; update imports accordingly. The `batchSize` option on `engine.startWorkflow` is also removed (it was a no-op that was never read by worker creation).

## v0.10.0 - 2026-05-16

### Added

- Added `step.invokeChildWorkflow()` for durable parent/child workflow orchestration. A parent can spawn a child workflow by ref or ID, pause itself with zero cost while the child runs, and resume with the child's output once it reaches a terminal state.

### Fixed

- Closed a race in `step.invokeChildWorkflow()` where a crash between committing the parent's pause and enqueuing the child job left the parent stuck in `PAUSED` forever. The child enqueue now runs inside the same transaction as the parent pause, so both succeed or roll back atomically.

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
[v0.10.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.9.0...v0.10.0
[v0.11.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.10.0...v0.11.0
