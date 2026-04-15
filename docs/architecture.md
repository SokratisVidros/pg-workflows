# Architecture

pg-workflows supports two deployment patterns: a **single-service** setup where one process handles both API requests and workflow execution, and a **microservices** setup where API and worker concerns are separated.

## Single Service (Monolith)

The simplest setup. One process runs the engine, registers workflows, and starts runs:

```typescript
import { WorkflowEngine, workflow } from 'pg-workflows'
import { z } from 'zod'

const onboardUser = workflow(
  'onboard-user',
  async ({ step, input }) => {
    const user = await step.run('create-account', async () => {
      return await db.users.create({ email: input.email })
    })
    await step.run('send-welcome', async () => {
      await sendEmail(user.email, 'Welcome!')
    })
    return { userId: user.id }
  },
  { inputSchema: z.object({ email: z.string().email() }) },
)

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL,
  workflows: [onboardUser],
})
await engine.start()

// Start a run from your API handler
const run = await engine.startWorkflow({
  workflowId: 'onboard-user',
  input: { email: 'alice@example.com' },
})
```

## Microservices (Client/Worker Separation)

In production, you often want your API service to be lightweight — it shouldn't need to import LLM SDKs, heavy processing code, or workflow handler logic. pg-workflows solves this with **workflow refs** and a **lightweight client**.

```
┌─────────────────────────┐
│  shared/workflows.ts    │   Refs only — no handler code
│  (WorkflowRef)          │
└──────────┬──────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌──────────────┐
│ API      │ │ Worker       │
│ Service  │ │ Service      │
│          │ │              │
│ Client   │ │ Engine +     │
│ (start,  │ │ Handlers     │
│  pause,  │ │ (execute     │
│  resume) │ │  steps)      │
└──────────┘ └──────────────┘
     │              │
     └──────┬───────┘
            ▼
     ┌─────────────┐
     │  PostgreSQL  │
     └─────────────┘
```

### Step 1: Define workflow refs (shared between services)

```typescript
// shared/workflows.ts
import { createWorkflowRef } from 'pg-workflows/client'
import { z } from 'zod'

export const onboardUser = createWorkflowRef('onboard-user', {
  inputSchema: z.object({ email: z.string().email() }),
})

export const processPayment = createWorkflowRef('process-payment', {
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
})
```

### Step 2: API service — uses lightweight client, no handler code

```typescript
// api-service.ts
import { WorkflowClient } from 'pg-workflows/client'
import { onboardUser } from './shared/workflows'

const client = new WorkflowClient({
  connectionString: process.env.DATABASE_URL,
})

// Type-safe — input is validated against the ref's schema
const run = await client.startWorkflow(onboardUser, {
  email: 'alice@example.com',
})

// Manage runs without knowing workflow internals
await client.pauseWorkflow({ runId: run.id })
await client.resumeWorkflow({ runId: run.id })
const progress = await client.checkProgress({ runId: run.id })
```

### Step 3: Worker service — full engine with handlers

```typescript
// worker-service.ts
import { WorkflowEngine } from 'pg-workflows'
import { onboardUser } from './shared/workflows'

// Call the ref with a handler to create a full definition
const onboardUserDef = onboardUser(async ({ step, input }) => {
  const user = await step.run('create-account', async () => {
    return await db.users.create({ email: input.email })
  })
  await step.run('send-welcome', async () => {
    await sendEmail(user.email, 'Welcome!')
  })
  return { userId: user.id }
})

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL,
  workflows: [onboardUserDef],
})
await engine.start()
```

The `pg-workflows/client` entrypoint bundles only the client, refs, and types — no AST parser, no handler code, no workflow registration logic.

## How It Works

pg-workflows uses PostgreSQL as both the **job queue** and the **state store**. Under the hood:

1. **Define** workflows as TypeScript functions with discrete steps
2. **Start** a workflow run — the engine creates a database record and enqueues the first execution
3. **Execute** steps one by one — each step's result is persisted before moving to the next
4. **Pause** on `waitFor()` or `pause()` — the workflow sleeps with zero resource consumption
5. **Resume** when an external event arrives or `resumeWorkflow()` is called
6. **Complete** — the final result is stored and the workflow is marked as done

All state lives in PostgreSQL. No Redis. No message broker. No external scheduler. Just Postgres.
