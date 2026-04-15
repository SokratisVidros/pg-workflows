# Changelog

All notable changes to this project will be documented in this file.

## v0.8.0 - 2026-04-15

### Added

- Added a dedicated `WorkflowClient` API and `WorkflowRef` support to separate client-side workflow operations from worker runtime concerns.
- Added a microservices example that demonstrates shared workflow definitions with distinct API and worker services.

### Fixed

- Improved workflow failure handling to surface all underlying errors instead of masking nested causes.

### Documentation

- Split the README into focused documentation pages under `docs/` to make architecture, configuration, API usage, and examples easier to navigate.

[v0.8.0]: https://github.com/SokratisVidros/pg-workflows/compare/v0.7.2...v0.8.0
