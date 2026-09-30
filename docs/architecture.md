# Architecture

pg-workflows runs in one of two layouts:

- **Single service.** One process starts runs and executes them.
- **API and worker.** API services start and manage runs with a lightweight client. Worker services load the handlers and execute steps.

Both layouts use the same database, and you can move from one to the other without migrating data.

## Single service

One process registers workflows, runs workers, and starts runs:

```typescript
import { WorkflowEngine, workflow } from 'pg-workflows'
import { z } from 'zod'

const onboardUser = workflow(
  'onboard-user',
  async ({ step, input }) => {
    const user = await step.run('create-account', async () => {
      return { id: `usr_${input.email}`, email: input.email }
    })
    await step.run('send-welcome', async () => {
      console.log(`Sending welcome email to ${user.email}`)
      return { sent: true }
    })
    return { userId: user.id }
  },
  { inputSchema: z.object({ email: z.email() }) },
)

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  workflows: [onboardUser],
})
await engine.start()

// Call this from a request handler
const run = await engine.startWorkflow({
  workflowId: 'onboard-user',
  input: { email: 'alice@example.com' },
})
```

To scale, run more copies of the process. Every engine that has called `start()` pulls runs from the same queue. Each engine runs [`WORKFLOW_RUN_WORKERS`](configuration.md#environment-variables) workers (default 3).

## API and worker

Use this layout when the API service shouldn't load worker dependencies such as LLM SDKs or heavy processing libraries. Both services share a file of **workflow refs**: an ID and input schema, with no handler code.

```
         shared/workflows.ts
       (refs: ID + input schema)
          │               │
          ▼               ▼
  ┌───────────────┐ ┌───────────────┐
  │  API service  │ │ Worker service│
  │ WorkflowClient│ │ WorkflowEngine│
  │ start, pause, │ │ + handlers    │
  │ resume, query │ │ execute steps │
  └───────┬───────┘ └───────┬───────┘
          │                 │
          └────────┬────────┘
                   ▼
              PostgreSQL
```

### 1. Define refs

```typescript
// shared/workflows.ts
import { createWorkflowRef } from 'pg-workflows/client'
import { z } from 'zod'

export const onboardUser = createWorkflowRef('onboard-user', {
  inputSchema: z.object({ email: z.email() }),
})
```

### 2. Start runs from the API service

```typescript
// api-service.ts
import { WorkflowClient } from 'pg-workflows/client'
import { onboardUser } from './shared/workflows'

const client = new WorkflowClient({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
})

// `input` is typed and validated against the ref's schema
const run = await client.startWorkflow(onboardUser, { email: 'alice@example.com' })

const current = await client.getRun({ runId: run.id })
console.log(current.status)
```

### 3. Execute runs in the worker service

```typescript
// worker-service.ts
import { WorkflowEngine } from 'pg-workflows'
import { onboardUser } from './shared/workflows'

const onboardUserDefinition = onboardUser(async ({ step, input }) => {
  const user = await step.run('create-account', async () => {
    return { id: `usr_${input.email}`, email: input.email }
  })
  await step.run('send-welcome', async () => {
    console.log(`Sending welcome email to ${user.email}`)
    return { sent: true }
  })
  return { userId: user.id }
})

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  workflows: [onboardUserDefinition],
})
await engine.start()
```

`pg-workflows/client` contains the client, refs, types, and errors. It does not include the engine or the handler parser.

The client doesn't load definitions, which has two consequences:

- **Singleton.** Set `singleton: true` on the ref, not only on the worker's definition. See [Singleton workflows](core-concepts.md#singleton-workflows).
- **Progress.** `client.checkProgress` can't report `totalSteps` or a percentage for an in-progress run. Use `getRun` and read `status` and `currentStepId`, or call `checkProgress` on an engine that has the workflow registered.

A runnable version of this layout is in [`examples/node/microservices`](../examples/node/microservices).

## Dashboard

The engine has no built-in UI. [`@pg-workflows/ui`](../packages/ui/README.md) is a separate package of React components and hooks for browsing runs and step timelines.

```
┌───────────┐   HTTP    ┌──────────────┐   pg-workflows   ┌────────────┐
│  Browser  │ ────────► │   Your API   │ ───────────────► │ PostgreSQL │
│  React +  │           │ getRuns and  │  WorkflowEngine  │            │
│  ui pkg   │           │ getRun       │  or Client       │            │
└───────────┘           └──────────────┘                  └────────────┘
```

The browser never connects to the database. Expose list and get endpoints on top of `getRuns` and `getRun`, then point the UI's `WorkflowRunsProvider` at them. Setup is in the [UI package README](../packages/ui/README.md).

Keep `@pg-workflows/ui` out of worker services. Its peer dependencies are React, Tailwind, and TanStack Query. The engine's only peer dependency is `pg`.

## How a run executes

PostgreSQL is both the job queue (through pg-boss) and the state store (`workflow_runs`).

1. **Start.** `startWorkflow` inserts a `workflow_runs` row with status `running` and enqueues a job.
2. **Execute.** A worker picks up the job and calls the handler.
3. **Save each step.** Each `step.run` result is written to the run's `timeline` before the handler moves on.
4. **Pause.** `waitFor`, `pause`, `delay`, `waitUntil`, `poll`, and `invokeChildWorkflow` save the run as `paused` and end the execution. No worker or connection is held while it waits.
5. **Resume.** An event, `resumeWorkflow`, a timer, or a finished child enqueues a new job. The handler runs from the top, and completed steps return their saved results.
6. **Finish.** The handler's return value is saved as `output` and the run is `completed`. If the handler throws, the run is retried up to `retries` times, then marked `failed`.
