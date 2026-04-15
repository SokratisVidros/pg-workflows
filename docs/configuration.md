# Configuration

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `WORKFLOW_RUN_WORKERS` | Number of worker processes | `3` |
| `WORKFLOW_RUN_EXPIRE_IN_SECONDS` | Job expiration time in seconds | `300` |

## Database Setup

The engine automatically runs migrations on startup to create the required tables:

- `workflow_runs` — stores workflow execution state, step results, and timeline in the `public` schema. The optional `resource_id` column (indexed) associates each run with an external entity in your application (see [Resource ID](core-concepts.md#resource-id)). The optional `idempotency_key` column has a unique partial index for [idempotent starts](core-concepts.md#idempotency-key).
- `pgboss_v12_pgworkflow.*` — pg-boss job queue tables for reliable task scheduling (isolated schema to avoid conflicts).

## Dependencies

- `pg` is a peer dependency — you bring your own PostgreSQL driver.
- `pg-boss` is bundled automatically as an internal dependency. You don't need to install or configure it. The engine creates pg-boss with an isolated schema (`pgboss_v12_pgworkflow`) so it never conflicts with other pg-boss installations in your project. Advanced users can pass their own `boss` instance to the engine constructor.
- The engine manages its own retry logic with exponential backoff (`2^retryCount * 1000ms`), independent of pg-boss's retry settings.

## Requirements

- Node.js >= 18.0.0
- PostgreSQL >= 10
- `pg` >= 8.0.0 (peer dependency)
- A [Standard Schema](https://github.com/standard-schema/standard-schema)-compliant validation library (Zod, Valibot, ArkType, etc.) if using `inputSchema`
