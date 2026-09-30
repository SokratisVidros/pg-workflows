# pg-workflows

Durable workflows for TypeScript, backed by PostgreSQL. Each step's result is saved, a retried run skips the steps that already finished, and a run can pause for an event, a timer, or a polled condition. There's no Redis, broker, or scheduler to run.

[![npm version](https://img.shields.io/npm/v/pg-workflows.svg)](https://www.npmjs.com/package/pg-workflows)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%3E%3D10-336791.svg)](https://www.postgresql.org/)

## Install with your coding agent

Paste this into Claude Code, Cursor, Codex, or any agent that can fetch a URL:

```
Add pg-workflows to this project. Fetch https://pgpworkflows.dev/skill.md and follow it step by step: pick the right layout for this codebase (monolith, web app plus worker, or microservices), install and verify the engine, add the @pg-workflows/ui dashboard for our stack, then ask me whether to add OpenTelemetry tracing.
```

Or install the skill: `npx skills add SokratisVidros/pg-workflows --skill pg-workflows-install`. See [Install with an agent](https://pgpworkflows.dev/docs/install-with-agent).

## Quickstart

**1. Start Postgres** (skip if you already have one):

```bash
docker run -d --name pg-workflows-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```

**2. Create a project:**

```bash
mkdir workflows-demo && cd workflows-demo
npm init -y
npm install pg-workflows pg zod
npm install -D tsx
```

**3. Save this as `index.ts`:**

```typescript
import { WorkflowEngine, WorkflowStatus, workflow } from 'pg-workflows'
import { z } from 'zod'

const greetUser = workflow(
  'greet-user',
  async ({ step, input }) => {
    const user = await step.run('load-user', async () => {
      return { name: input.name, signedUpAt: new Date().toISOString() }
    })

    const message = await step.run('build-message', async () => {
      return `Welcome, ${user.name}!`
    })

    return { message }
  },
  { inputSchema: z.object({ name: z.string() }) },
)

async function main() {
  const engine = new WorkflowEngine({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
    workflows: [greetUser],
  })
  await engine.start()

  const run = await engine.startWorkflow({
    workflowId: 'greet-user',
    input: { name: 'Ada' },
  })

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

**4. Run it:**

```bash
npx tsx index.ts
```

After the engine's startup logs, you should see:

```
completed { message: 'Welcome, Ada!' }
```

`engine.start()` creates its tables on first run. Each `step.run` result is saved on the run's row in `workflow_runs`. When a run is retried (set `retries` on the workflow), completed steps return their saved result instead of running again.

## Wait for an event

`step.waitFor` pauses the run until your code calls `triggerEvent`. A paused run holds no worker and no connection.

```typescript
import { WorkflowEngine, WorkflowStatus, workflow } from 'pg-workflows'
import { z } from 'zod'

const approveExpense = workflow(
  'approve-expense',
  async ({ step, input }) => {
    await step.run('notify-manager', async () => {
      return { notified: `manager of ${input.employee}` }
    })

    const review = await step.waitFor('wait-for-review', {
      eventName: 'expense-reviewed',
      schema: z.object({ approved: z.boolean() }),
    })

    return { amount: input.amount, approved: review.approved }
  },
  { inputSchema: z.object({ employee: z.string(), amount: z.number() }) },
)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const engine = new WorkflowEngine({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
    workflows: [approveExpense],
  })
  await engine.start()

  const run = await engine.startWorkflow({
    workflowId: 'approve-expense',
    input: { employee: 'ada', amount: 120 },
  })

  // In a real app, this is a separate request: an approval button, a webhook, and so on.
  while ((await engine.getRun({ runId: run.id })).status !== WorkflowStatus.PAUSED) await sleep(200)

  await engine.triggerEvent({
    runId: run.id,
    eventName: 'expense-reviewed',
    data: { approved: true },
  })

  let result = await engine.getRun({ runId: run.id })
  while (result.status !== WorkflowStatus.COMPLETED && result.status !== WorkflowStatus.FAILED) {
    await sleep(200)
    result = await engine.getRun({ runId: run.id })
  }

  console.log(result.status, result.output) // completed { amount: 120, approved: true }
  await engine.stop()
}

main()
```

## Features

| Feature | API |
|---------|-----|
| Durable steps | `step.run(id, fn)` |
| Wait for external events | `step.waitFor(id, { eventName, timeout?, schema? })` + `engine.triggerEvent()` |
| Timers | `step.delay(id, '3 days')`, `step.waitUntil(id, date)` |
| Polling | `step.poll(id, fn, { interval, timeout })` |
| Manual pause and resume | `step.pause(id)`, `engine.resumeWorkflow()` |
| Child workflows | `step.invokeChildWorkflow(id, ref, input)` |
| Recurring schedules | `workflow(id, fn, { schedule: '0 9 * * 1-5' })` |
| Retries | `workflow(id, fn, { retries: 3 })` |
| Priorities | `workflow(id, fn, { priority: 'high' })` |
| One run at a time | `workflow(id, fn, { singleton: true })` |
| Deduplicated starts | `startWorkflow({ idempotencyKey })` |
| Tenant scoping | `resourceId` on every run and every API call |
| Typed input | Any [Standard Schema](https://github.com/standard-schema/standard-schema) library (Zod, Valibot, ArkType) |
| API/worker split | `WorkflowClient` from `pg-workflows/client` |

## Documentation

Full docs are at **[pgpworkflows.dev](https://pgpworkflows.dev)**.

| Guide | Covers |
|-------|--------|
| [Core concepts](https://pgpworkflows.dev/docs/concepts/workflows) | Steps, events, timers, polling, child workflows, schedules, retries, priorities, singletons, idempotency, input validation |
| [Deployment layouts](https://pgpworkflows.dev/docs/layouts) | Single-service and API/worker deployments |
| [Examples](https://pgpworkflows.dev/docs/guides/examples) | Conditional steps, fan-out loops, reminders, polling, retries, progress |
| [AI and agent workflows](https://pgpworkflows.dev/docs/guides/ai-agents) | Durable LLM pipelines, human review, retrieval |
| [API reference](https://pgpworkflows.dev/docs/reference/api) | `WorkflowEngine`, `WorkflowClient`, `WorkflowRef`, `workflow()`, types |
| [Configuration](https://pgpworkflows.dev/docs/reference/configuration) | Environment variables, database objects, requirements |

### Packages

| Package | Purpose |
|---------|---------|
| [`pg-workflows`](https://www.npmjs.com/package/pg-workflows) | The engine and client |
| [`@pg-workflows/otel`](packages/otel/README.md) | OpenTelemetry spans for workflow runs and steps |
| [`@pg-workflows/ui`](packages/ui/README.md) | React dashboard, components, and hooks. Try it with `npx @pg-workflows/ui` |

Runnable scripts live in [`examples/`](https://github.com/SokratisVidros/pg-workflows/tree/main/examples).

## Requirements

- Node.js >= 18
- PostgreSQL >= 10
- `pg` >= 8 (peer dependency). `pg-boss` ships with the engine and needs no setup.

## Acknowledgments

[Temporal](https://temporal.io/), [Inngest](https://www.inngest.com/), [Trigger.dev](https://trigger.dev/), and [DBOS](https://www.dbos.dev/) pioneered the durable execution patterns this project builds on.

## License

MIT
