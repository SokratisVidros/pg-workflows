# Microservices: many services start runs, one worker service executes them

Services that start, control, or query runs use `WorkflowClient` and import only refs. One worker service holds every handler and runs the `WorkflowEngine`. All of them point at the same Postgres database.

```
      @acme/workflow-refs  (refs: ID + input schema)
         │            │             │
         ▼            ▼             ▼
  ┌────────────┐ ┌────────────┐ ┌────────────────┐
  │ orders-api │ │ billing-api│ │ workflow-worker│
  │ Client     │ │ Client     │ │ Engine +       │
  │            │ │            │ │ every handler  │
  └─────┬──────┘ └─────┬──────┘ └───────┬────────┘
        └──────────────┼────────────────┘
                       ▼
                   PostgreSQL
```

## The ownership rule

Every engine with running workers pulls from one queue per database. A worker that picks up a run for a workflow it doesn't register fails that attempt with `Workflow <id> not found`. So:

- **One worker service owns every workflow definition** for a database. To scale it, run more replicas of that service.
- **API services never run `WorkflowEngine` workers.** They use `WorkflowClient`.
- If two teams need separately deployed workers with their own handlers, give each worker group its own database.

Explain this rule to the user if the repo has several services that might each want their own workflows.

## 1. Share the refs

Create the refs where every service can import them:

- **Monorepo:** a small workspace package, for example `packages/workflow-refs`, that depends on `pg-workflows` and the schema library.
- **Separate repos:** a published internal package. If that's too much for now, a copied `refs.ts` works, but the copies must stay identical. Tell the user about the drift risk.

```typescript
// packages/workflow-refs/src/index.ts
import { createWorkflowRef } from 'pg-workflows/client'
import { z } from 'zod'

export const onboardUser = createWorkflowRef('onboard-user', {
  inputSchema: z.object({ email: z.email() }),
})

export const nightlySync = createWorkflowRef('nightly-sync', {
  singleton: true, // set singleton on the ref: clients can't read the worker's definition
})
```

Import only from `pg-workflows/client` in this package, so API services never load the engine.

## 2. Install

| Service | Install |
|---------|---------|
| Refs package | `pg-workflows`, the schema library (`zod`) |
| Each API service | `pg-workflows`, `pg`, the refs package |
| Worker service | `pg-workflows`, `pg`, the refs package, and whatever the handlers need |

Use each service's package manager.

## 3. API services: start runs with the client

```typescript
// orders-api/src/workflows.ts
import { WorkflowClient } from 'pg-workflows/client'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

export const workflowClient = new WorkflowClient({ connectionString })
```

```typescript
import { onboardUser } from '@acme/workflow-refs'
import { workflowClient } from './workflows'

const run = await workflowClient.startWorkflow(onboardUser, { email: 'alice@example.com' })
```

The client connects and runs migrations on first use. Call `await workflowClient.stop()` on shutdown. If a service runs on a dev server with hot reload, cache the client on `globalThis` the same way [worker.md](worker.md) does.

## 4. The worker service

Follow steps 3 and 4 of [worker.md](worker.md): call each ref with its handler, export one `workflows` array holding **every** definition, and start a `WorkflowEngine` with it from the worker's entry point. It must be a long-running process.

## 5. Verify

1. Start the worker and wait for its startup log.
2. From one API service, start a run with the client and poll `getRun` until it finishes, as in the check script in [worker.md](worker.md).

Expected: the run reaches `completed` with the handler's output. `pending` forever means the worker isn't running or uses another database. `Workflow <id> not found` means a process with engine workers doesn't register that workflow. Find it and apply the ownership rule.
