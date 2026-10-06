# Web app plus worker: one codebase, two processes

The web app starts and controls runs with a `WorkflowClient`, and loads no handler code. A separate worker process from the same repo runs the `WorkflowEngine` and executes steps. The two share a module of **refs**: each ref is a workflow ID plus its input schema, with no handler.

```
src/workflows/refs.ts        refs: ID + input schema     imported by both
src/workflows/definitions.ts handlers (worker only)      refs + step code
src/workflows/client.ts      WorkflowClient (web only)
src/worker.ts                WorkflowEngine entry point  the worker process
```

Use the project's own directory conventions. In a monorepo, put the refs in a shared package both apps depend on, and the worker in its own app.

## 1. Install

```bash
npm install pg-workflows pg zod
```

Use the project's package manager. Offer a local Postgres if the user has none:

```bash
docker run -d --name pg-workflows-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```

## 2. Define refs

Import only from `pg-workflows/client` here, so the web bundle never pulls in the engine or the handler parser.

```typescript
// src/workflows/refs.ts
import { createWorkflowRef } from 'pg-workflows/client'
import { z } from 'zod'

export const helloRef = createWorkflowRef('hello', {
  inputSchema: z.object({ name: z.string() }),
})
```

For a workflow that allows only one run at a time, set `singleton: true` **on the ref**. The client never sees the handler's options, so a singleton set only on the definition isn't enforced for runs the web app starts.

## 3. Write the handlers (worker only)

Call each ref with a handler to get a full definition:

```typescript
// src/workflows/definitions.ts
import { helloRef } from './refs'

export const hello = helloRef(
  async ({ step, input }) => {
    return step.run('build-greeting', async () => ({ message: `Hello, ${input.name}!` }))
  },
  { retries: 3 },
)

// The worker must register every workflow in this database.
export const workflows = [hello]
```

The second argument accepts every `workflow()` option except `inputSchema`, which comes from the ref.

## 4. Create the worker entry point

```typescript
// src/worker.ts
import { WorkflowEngine } from 'pg-workflows'
import { workflows } from './workflows/definitions'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const engine = new WorkflowEngine({ connectionString, workflows })
  await engine.start()
  console.log('pg-workflows worker started')

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await engine.stop()
      process.exit(0)
    })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Add scripts alongside the existing ones. Use the runner the project already has (`tsx`, `bun`, or a compiled `node dist/worker.js`):

```json
{
  "scripts": {
    "worker": "tsx src/worker.ts",
    "worker:dev": "tsx watch src/worker.ts"
  }
}
```

Each worker process runs `WORKFLOW_RUN_WORKERS` concurrent executions (default `3`). To scale, run more worker replicas.

## 5. Start runs from the web app

```typescript
// src/workflows/client.ts
import { WorkflowClient } from 'pg-workflows/client'

const globalForClient = globalThis as unknown as { workflowClient?: WorkflowClient }

export function getWorkflowClient() {
  if (!globalForClient.workflowClient) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    globalForClient.workflowClient = new WorkflowClient({ connectionString })
  }
  return globalForClient.workflowClient
}
```

```typescript
import { getWorkflowClient } from '@/workflows/client'
import { helloRef } from '@/workflows/refs'

// `input` is typed and validated against the ref's schema.
const run = await getWorkflowClient().startWorkflow(helloRef, { name: 'Ada' })
```

The client connects and runs migrations on first use. It has the engine's run and query methods: `getRun`, `getRuns`, `getStats`, `listWorkflowIds`, `pauseWorkflow`, `resumeWorkflow`, `cancelWorkflow`, `triggerEvent`, and `fastForwardWorkflow`. `listWorkflowIds` on the client returns distinct workflow IDs from runs only. `checkProgress` on the client reports `completedSteps` accurately, but `totalSteps` stays `0` until the run completes.

On serverless hosts, the web app keeps working this way. Only the worker needs a long-running host.

## 6. Wire up deployment

Add the worker as its own process wherever the project declares processes: a second service in `docker-compose.yml`, a `worker:` line in the `Procfile`, a second service on Railway, Render, or Fly, or a second Kubernetes Deployment. It needs the same `DATABASE_URL` as the web app. If there's no deployment config to extend, tell the user the worker must be deployed as a long-running process, and move on.

## 7. Verify

1. Start the worker (`npm run worker:dev`) and wait for `pg-workflows worker started`.
2. Start a run with the client, from a route in the app or from a script run with the project's env loaded:

   ```typescript
   // scripts/pg-workflows-check.ts
   import { WorkflowStatus } from 'pg-workflows/client'
   import { getWorkflowClient } from '../src/workflows/client'
   import { helloRef } from '../src/workflows/refs'

   async function main() {
     const client = getWorkflowClient()
     const run = await client.startWorkflow(helloRef, { name: 'Ada' })

     let result = await client.getRun({ runId: run.id })
     while (result.status === WorkflowStatus.PENDING || result.status === WorkflowStatus.RUNNING) {
       await new Promise((resolve) => setTimeout(resolve, 200))
       result = await client.getRun({ runId: run.id })
     }

     console.log(result.status, result.output)
     await client.stop()
   }

   main()
   ```

Expected output: `completed { message: 'Hello, Ada!' }`. If the run stays `pending`, the worker isn't running or is pointed at another database. If it fails with `Workflow hello not found`, some process with engine workers doesn't register `hello`.
