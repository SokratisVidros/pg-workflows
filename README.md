# pg-workflows

**The simplest Postgres workflow engine for TypeScript.** Durable execution, event-driven orchestration, and automatic retries - powered entirely by PostgreSQL. No Redis, no message broker, no new infrastructure.

[![npm version](https://img.shields.io/npm/v/pg-workflows.svg)](https://www.npmjs.com/package/pg-workflows)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%3E%3D10-336791.svg)](https://www.postgresql.org/)

```bash
npm install pg-workflows pg
```

---

## A complete workflow

```typescript
import { WorkflowEngine, workflow } from 'pg-workflows'
import { z } from 'zod'

const onboardUser = workflow(
  'onboard-user',
  async ({ step, input }) => {
    const user = await step.run('create-account', () => db.users.create(input))
    await step.run('send-welcome', () => sendEmail(user.email, 'Welcome!'))
    return { userId: user.id }
  },
  { inputSchema: z.object({ email: z.string().email() }) },
)

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL,
  workflows: [onboardUser],
})
await engine.start()

await engine.startWorkflow({
  workflowId: 'onboard-user',
  input: { email: 'alice@example.com' },
})
```

That's it. Each step runs **exactly once**. Crash, redeploy, or retry - the workflow resumes from where it left off. State lives in your existing PostgreSQL database.

---

## Why pg-workflows

- **Zero new infrastructure** - if you have Postgres, you're done. No Redis, no Temporal server, no SaaS bill.
- **Feels like plain TypeScript** - workflows are async functions. No DSL, no YAML, no DAG builder.
- **Durable by default** - step results are persisted. Process crashes don't lose work or repeat expensive calls.
- **Pause, wait, resume** - `step.waitFor('event-name')` pauses the workflow until your API fires an event. Zero resources consumed while waiting.
- **Schedules & polling built in** - `step.delay('3 days')`, `step.waitUntil('2025-01-01')`, `step.poll(...)` - no cron, no external scheduler.
- **Built for AI agents** - cache expensive LLM calls, retry on 429s, pause for human review. [See AI patterns →](docs/ai-agents.md)
- **Client/worker separation** - keep your API service light; run handlers in a worker. [See architecture →](docs/architecture.md)
- **Idempotent starts** - pass an `idempotencyKey` and duplicate calls safely return the same run.

---

## Quick start

### 1. Install

```bash
npm install pg-workflows pg
```

> `pg` is a peer dependency. `pg-boss` is bundled - nothing else to configure. The engine runs migrations automatically on start.

### 2. Define a workflow

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'

export const sendWelcome = workflow(
  'send-welcome',
  async ({ step, input }) => {
    const user = await step.run('create-user', async () => {
      return { id: '123', email: input.email }
    })

    await step.run('send-email', async () => {
      await sendEmail(user.email, 'Welcome!')
    })

    // Pause until your API confirms the user. Zero cost while waiting.
    const confirmation = await step.waitFor('await-confirmation', {
      eventName: 'user-confirmed',
      timeout: 24 * 60 * 60 * 1000, // 24 hours
    })

    return { success: true, user, confirmation }
  },
  {
    inputSchema: z.object({ email: z.string().email() }),
    retries: 3,
  },
)
```

### 3. Start the engine and run it

```typescript
import { WorkflowEngine } from 'pg-workflows'
import { sendWelcome } from './workflows'

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL,
  workflows: [sendWelcome],
})
await engine.start()

const run = await engine.startWorkflow({
  workflowId: 'send-welcome',
  input: { email: 'user@example.com' },
})

// Later - resume the workflow with an event:
await engine.triggerEvent({
  runId: run.id,
  eventName: 'user-confirmed',
  data: { confirmedAt: new Date() },
})

// Track progress anytime:
const progress = await engine.checkProgress({ runId: run.id })
console.log(`${progress.completionPercentage}% complete`)
```

That's the whole loop. No extra services. Everything durable. Everything queryable with plain SQL.

---

## What can you build?

- **AI agents & LLM pipelines** - durable multi-step agents, cached expensive calls, human-in-the-loop
- **User onboarding** - signup flows with email verification and conditional paths
- **Payment & checkout** - retry-safe payment processing with event-driven confirmations
- **Background job orchestration** - replace fragile cron jobs with observable workflows
- **Approval workflows** - pause indefinitely until a human reviews
- **Data pipelines** - ETL with step-by-step durability and progress tracking

See [runnable examples](https://github.com/SokratisVidros/pg-workflows/tree/main/examples) and [common patterns →](docs/examples.md)

---

## Documentation

- **[Architecture](docs/architecture.md)** - single-service and microservices (client/worker) setups
- **[Core Concepts](docs/core-concepts.md)** - workflows, steps, events, delays, polling, pause/resume, idempotency, input validation
- **[AI & Agent Workflows](docs/ai-agents.md)** - durable LLM pipelines, human-in-the-loop, RAG
- **[Examples](docs/examples.md)** - conditional steps, batch loops, scheduled reminders, retries, monitoring
- **[API Reference](docs/api-reference.md)** - `WorkflowEngine`, `WorkflowClient`, `WorkflowRef`, types
- **[Configuration](docs/configuration.md)** - env vars, database setup, requirements

---

## Requirements

- Node.js >= 18
- PostgreSQL >= 10

## Acknowledgments

Special thanks to the teams behind [Temporal](https://temporal.io/), [Inngest](https://www.inngest.com/), [Trigger.dev](https://trigger.dev/), and [DBOS](https://www.dbos.dev/) for pioneering durable execution patterns and inspiring this project.

## License

MIT
