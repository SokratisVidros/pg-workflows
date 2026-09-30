# Monolith: one service starts and executes workflows

One long-running process holds a `WorkflowEngine`. The engine registers the workflows, runs the workers, and starts runs from request handlers. To scale, run more replicas of the same process. They share the queue.

## 1. Install

```bash
npm install pg-workflows pg zod
```

Use the project's package manager. Skip `zod` if the project already uses another Standard Schema library.

If the user has no Postgres yet, offer a local one:

```bash
docker run -d --name pg-workflows-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```

Then add `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres` to the env file the project already loads.

## 2. Define the workflows

Put definitions in one module that exports them as an array. The engine must register every one of them (see "One queue per database" in SKILL.md).

```typescript
// src/workflows/index.ts
import { workflow } from 'pg-workflows'
import { z } from 'zod'

export const helloWorkflow = workflow(
  'hello',
  async ({ step, input }) => {
    const greeting = await step.run('build-greeting', async () => {
      return { message: `Hello, ${input.name}!` }
    })
    return greeting
  },
  { inputSchema: z.object({ name: z.string() }), retries: 3 },
)

export const workflows = [helloWorkflow]
```

Step IDs must be unique within a workflow. Inside loops, build them from the item: `` step.run(`charge-${order.id}`, ...) ``.

## 3. Create one engine per process

```typescript
// src/workflows/engine.ts
import { WorkflowEngine } from 'pg-workflows'
import { workflows } from './index'

// Cache on globalThis so dev-server hot reloads don't open another pool and
// another set of workers every time this module is re-evaluated.
const globalForEngine = globalThis as unknown as { workflowEngine?: WorkflowEngine }

export function getEngine() {
  if (!globalForEngine.workflowEngine) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    globalForEngine.workflowEngine = new WorkflowEngine({ connectionString, workflows })
  }
  return globalForEngine.workflowEngine
}
```

If the project already has a `pg.Pool`, pass `{ pool, workflows }` instead of `connectionString`. The engine then leaves closing the pool to the project.

## 4. Start the engine at boot and stop it on shutdown

`start()` runs migrations, registers the workflows, and starts the workers. Calling it again does nothing. Start the engine when the process boots, not on the first request, so queued runs execute even when no request arrives.

**Express, Fastify, Hono on Node, or any `node:http` server.** Start it before `listen`:

```typescript
import { getEngine } from './workflows/engine'

await getEngine().start()
app.listen(port)

process.on('SIGTERM', async () => {
  await getEngine().stop()
  process.exit(0)
})
```

**Next.js.** Use `instrumentation.ts` at the project root, or in `src/` if the app uses it. This runs once per server process:

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEngine } = await import('./src/workflows/engine')
    await getEngine().start()
  }
}
```

Adjust the import path to where you put the engine. Any route that imports the engine must run on the Node.js runtime, not Edge. If the app is deployed to Vercel or another serverless host, stop: that's the worker layout ([worker.md](worker.md)).

## 5. Start runs from the app

```typescript
import { getEngine } from './workflows/engine'

const run = await getEngine().startWorkflow({
  workflowId: 'hello',
  input: { name: 'Ada' },
  resourceId: user.id, // optional: scopes the run to a user or tenant
})
```

Return `run.id` to the caller if they need to check on it later with `getRun({ runId })`.

## 6. Verify

Add a script that runs one workflow end to end against the project's database, and run it with the project's TypeScript runner (`tsx`, `bun`, or `ts-node`):

```typescript
// scripts/pg-workflows-check.ts
import { WorkflowStatus } from 'pg-workflows'
import { getEngine } from '../src/workflows/engine'

async function main() {
  const engine = getEngine()
  await engine.start()

  const run = await engine.startWorkflow({ workflowId: 'hello', input: { name: 'Ada' } })

  let result = await engine.getRun({ runId: run.id })
  while (result.status === WorkflowStatus.PENDING || result.status === WorkflowStatus.RUNNING) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    result = await engine.getRun({ runId: run.id })
  }

  console.log(result.status, result.output)
  await engine.stop()
}

main()
```

Load the env the same way the app does, for example `npx tsx --env-file=.env scripts/pg-workflows-check.ts`. Expected output, after the engine's startup logs: `completed { message: 'Hello, Ada!' }`. Show the user the output. Keep the script if they want it, otherwise delete it.
