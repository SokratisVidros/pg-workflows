# pg-workflows

**The simplest Postgres workflow engine for TypeScript.** Durable execution, event-driven orchestration, and automatic retries - powered entirely by PostgreSQL. No extra infrastructure. No vendor lock-in.

[![npm version](https://img.shields.io/npm/v/pg-workflows.svg)](https://www.npmjs.com/package/pg-workflows)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%3E%3D10-336791.svg)](https://www.postgresql.org/)

```bash
npm install pg-workflows pg
```

---

## Why pg-workflows?

Most workflow engines ask you to adopt an entirely new platform - a new runtime, a new deployment target, a new bill. **pg-workflows takes a different approach**: if you already have PostgreSQL, you already have everything you need.

| | pg-workflows | Temporal | Inngest | DBOS | pgflow |
|---|:---:|:---:|:---:|:---:|:---:|
| **Runs on your existing Postgres** | Yes | No | No | Partial | Supabase only |
| **Zero extra infrastructure** | Yes | No | No | No | No |
| **Framework-agnostic** | Yes | Yes | No | Yes | No |
| **Event-driven pause/resume** | Yes | Yes | Yes | No | No |
| **Open source** | MIT | MIT | ELv2 | MIT | Apache-2.0 |
| **TypeScript-first** | Yes | Via SDK | Yes | Via SDK | Yes |

### When to use pg-workflows

- You already run **PostgreSQL** and want to add durable workflows without new services
- You need a **lightweight, self-hosted** workflow engine with zero operational overhead
- You want **event-driven orchestration** (pause, resume, wait for external signals)
- You're building **AI agents or LLM pipelines** that need durable execution, retries, and human-in-the-loop
- You're building with **TypeScript/Node.js** and want a native developer experience

### When to consider alternatives

If you need enterprise-grade features like distributed tracing, complex DAG scheduling, or plan to scale to millions of concurrent workflows, consider [Temporal](https://temporal.io/), [Inngest](https://www.inngest.com/), [Trigger.dev](https://trigger.dev/), or [DBOS](https://www.dbos.dev/).

---

## Features

- **Durable Execution on Postgres** - Workflow state is persisted in PostgreSQL. Workflows survive process crashes, restarts, and deployments.
- **Step-by-Step Execution** - Break complex processes into discrete, resumable steps. Each step runs exactly once, even across retries.
- **Event-Driven Orchestration** - Pause workflows and wait for external events with `step.waitFor()`. Resume automatically when signals arrive.
- **Polling Steps** - Repeatedly check a condition with `step.poll()` at a configurable interval (minimum 30s) until it returns a truthy value or a timeout expires.
- **Scheduled & Delay Steps** - Wait until a specific date with `step.waitUntil()`, or use `step.delay()` / `step.sleep()` with human-readable durations (`'3 days'`, `{ hours: 2 }`). Past dates run immediately.
- **Pause and Resume** - Manually pause long-running workflows and resume them later via API.
- **Built-in Retries** - Automatic retries with exponential backoff at the workflow level.
- **Configurable Timeouts** - Set workflow-level and step-level timeouts to prevent runaway executions.
- **Progress Tracking** - Monitor workflow completion percentage, completed steps, and total steps in real-time.
- **Input Validation** - Define schemas with Zod for type-safe, validated workflow inputs.
- **Built on pg-boss** - Leverages the battle-tested [pg-boss](https://github.com/timgit/pg-boss) job queue for reliable task scheduling. pg-boss is bundled as a dependency - no separate install or configuration needed.

---

## How It Works

pg-workflows uses PostgreSQL as both the **job queue** and the **state store**. Under the hood:

1. **Define** workflows as TypeScript functions with discrete steps
2. **Start** a workflow run - the engine creates a database record and enqueues the first execution
3. **Execute** steps one by one - each step's result is persisted before moving to the next
4. **Pause** on `waitFor()` or `pause()` - the workflow sleeps with zero resource consumption
5. **Resume** when an external event arrives or `resumeWorkflow()` is called
6. **Complete** - the final result is stored and the workflow is marked as done

All state lives in PostgreSQL. No Redis. No message broker. No external scheduler. Just Postgres.

---

## Quick Start

### 1. Install

```bash
npm install pg-workflows pg
# or
yarn add pg-workflows pg
# or
bun add pg-workflows pg
```

> `pg` is a peer dependency - you bring your own PostgreSQL driver. `pg-boss` is bundled automatically.

### 2. Define a Workflow

```typescript
import { WorkflowEngine, workflow } from 'pg-workflows';
import { z } from 'zod';

// Define a durable workflow
const sendWelcomeEmail = workflow(
  'send-welcome-email',
  async ({ step, input }) => {
    // Step 1: Create user record (runs exactly once)
    const user = await step.run('create-user', async () => {
      return { id: '123', email: input.email };
    });

    // Step 2: Send email (runs exactly once)
    await step.run('send-email', async () => {
      await sendEmail(user.email, 'Welcome!');
    });

    // Step 3: Wait for user confirmation (pauses the workflow)
    const confirmation = await step.waitFor('wait-confirmation', {
      eventName: 'user-confirmed',
      timeout: 24 * 60 * 60 * 1000, // 24 hours
    });

    return { success: true, user, confirmation };
  },
  {
    inputSchema: z.object({
      email: z.string().email(),
    }),
    timeout: 48 * 60 * 60 * 1000, // 48 hours
    retries: 3,
  }
);
```

### 3. Start the Engine

```typescript
// Option A: Connection string (simplest - engine manages everything)
const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL,
  workflows: [sendWelcomeEmail],
});

// Option B: Bring your own pg.Pool
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const engine = new WorkflowEngine({
  pool,
  workflows: [sendWelcomeEmail],
});

await engine.start();
```

### 4. Run Workflows

```typescript
// Start a workflow run
const run = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  resourceId: 'user-123',
  input: { email: 'user@example.com' },
});

// Send an event to resume the waiting workflow
await engine.triggerEvent({
  runId: run.id,
  resourceId: 'user-123',
  eventName: 'user-confirmed',
  data: { confirmedAt: new Date() },
});

// Check progress
const progress = await engine.checkProgress({
  runId: run.id,
  resourceId: 'user-123',
});

console.log(`Progress: ${progress.completionPercentage}%`);
```

---

## What Can You Build?

- **AI Agents & LLM Pipelines** - Build durable AI agents that survive crashes, retry on flaky LLM APIs, and pause for human-in-the-loop review. [See examples below.](#ai--agent-workflows)
- **User Onboarding Flows** - Multi-step signup sequences with email verification, waiting for user actions, and conditional paths.
- **Payment & Checkout Pipelines** - Durable payment processing that survives failures, with automatic retries and event-driven confirmations.
- **Background Job Orchestration** - Replace fragile cron jobs with durable, observable workflows that track progress.
- **Approval Workflows** - Pause execution and wait for human approval events before proceeding.
- **Data Processing Pipelines** - ETL workflows with step-by-step execution, error handling, and progress monitoring.

---

## AI & Agent Workflows

AI agents and LLM pipelines are one of the best use cases for durable execution. LLM calls are **slow**, **expensive**, and **unreliable** - exactly the kind of work that should never be repeated unnecessarily. pg-workflows gives you:

- **Cached step results** - If your process crashes after a $0.50 GPT-4 call, the result is already persisted. On retry, it skips the LLM call and picks up where it left off.
- **Automatic retries** - LLM APIs return 429s and 500s. Built-in exponential backoff handles transient failures without custom retry logic.
- **Human-in-the-loop** - Pause an AI pipeline with `step.waitFor()` to wait for human review, approval, or feedback before continuing.
- **Observable progress** - Track which step your agent is on, how far along it is, and inspect intermediate results with `checkProgress()`.
- **Long-running agents** - Multi-step agents that run for minutes or hours don't need to hold a connection open. They persist state and resume.

### Example: Multi-Step AI Agent

```typescript
const researchAgent = workflow(
  'research-agent',
  async ({ step, input }) => {
    // Step 1: Plan the research (persisted - never re-runs on retry)
    const plan = await step.run('create-plan', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Create a research plan for: ${input.topic}` }],
      });
    });

    // Step 2: Execute each research task durably
    const findings = [];
    for (const task of plan.tasks) {
      const result = await step.run(`research-${task.id}`, async () => {
        return await llm.chat({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: `Research: ${task.description}` }],
        });
      });
      findings.push(result);
    }

    // Step 3: Synthesize results
    const report = await step.run('synthesize', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Synthesize these findings: ${JSON.stringify(findings)}` }],
      });
    });

    return { plan, findings, report };
  },
  {
    retries: 3,
    timeout: 30 * 60 * 1000, // 30 minutes
  }
);
```

If the process crashes after completing 3 of 5 research tasks, the agent **resumes from task 4** - no LLM calls are wasted.

### Example: Human-in-the-Loop AI Pipeline

```typescript
const contentPipeline = workflow(
  'ai-content-pipeline',
  async ({ step, input }) => {
    // Step 1: Generate draft with AI
    const draft = await step.run('generate-draft', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Write a blog post about: ${input.topic}` }],
      });
    });

    // Step 2: Pause for human review - costs nothing while waiting
    const review = await step.waitFor('human-review', {
      eventName: 'content-reviewed',
      timeout: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Step 3: Revise based on feedback
    if (review.approved) {
      return { status: 'published', content: draft };
    }

    const revision = await step.run('revise-draft', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: `Revise this draft based on feedback:\n\nDraft: ${draft}\n\nFeedback: ${review.feedback}` },
        ],
      });
    });

    return { status: 'revised', content: revision };
  },
  { retries: 3 }
);

// A reviewer approves or requests changes via your API
await engine.triggerEvent({
  runId: run.id,
  eventName: 'content-reviewed',
  data: { approved: false, feedback: 'Make the intro more engaging' },
});
```

### Example: RAG Pipeline with Tool Use

```typescript
const ragAgent = workflow(
  'rag-agent',
  async ({ step, input }) => {
    // Step 1: Generate embeddings (cached on retry)
    const embedding = await step.run('embed-query', async () => {
      return await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: input.query,
      });
    });

    // Step 2: Search vector store
    const documents = await step.run('search-docs', async () => {
      return await vectorStore.search(embedding, { topK: 10 });
    });

    // Step 3: Generate answer with context
    const answer = await step.run('generate-answer', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Answer using these documents:\n${documents.map(d => d.text).join('\n')}` },
          { role: 'user', content: input.query },
        ],
      });
    });

    // Step 4: Validate and fact-check
    const validation = await step.run('fact-check', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: `Fact-check this answer against the source documents. Answer: ${answer}` },
        ],
      });
    });

    return { answer, validation, sources: documents };
  },
  { retries: 3, timeout: 5 * 60 * 1000 }
);
```

### Why Durable Execution Matters for AI

| Problem | Without pg-workflows | With pg-workflows |
|---------|---------------------|-------------------|
| Process crashes mid-pipeline | All LLM calls re-run from scratch | Resumes from the last completed step |
| LLM API returns 429/500 | Manual retry logic everywhere | Automatic retries with exponential backoff |
| Human review needed | Custom polling/webhook infrastructure | `step.waitFor()` - zero resource consumption while waiting |
| Debugging failed agents | Lost intermediate state | Full timeline of every step's input/output in PostgreSQL |
| Cost control | Repeated expensive LLM calls on failure | Each LLM call runs exactly once, result cached |
| Long-running pipelines | Timeout or lost connections | Runs for hours/days, state persisted in Postgres |

---

## Core Concepts

### Workflows

A workflow is a durable function that breaks complex operations into discrete, resumable steps. Define workflows using the `workflow()` function:

```typescript
const myWorkflow = workflow(
  'workflow-id',
  async ({ step, input }) => {
    // Your workflow logic here
  },
  {
    inputSchema: z.object({ /* ... */ }),
    timeout: 60000, // milliseconds
    retries: 3,
  }
);
```

### Steps

Steps are the building blocks of durable workflows. Each step is executed **exactly once**, even if the workflow is retried:

```typescript
await step.run('step-id', async () => {
  // This will only execute once - the result is persisted in Postgres
  return { result: 'data' };
});
```

### Event-Driven Workflows

Wait for external events to pause and resume workflows without consuming resources:

```typescript
const eventData = await step.waitFor('wait-step', {
  eventName: 'payment-completed',
  timeout: 5 * 60 * 1000, // 5 minutes
});
```

### Scheduled and Delay Steps

Wait until a specific time, or delay for a duration (sugar over `waitUntil`). If the date is in the past, the step runs immediately.

```typescript
// Wait until a specific date (Date, ISO string, or { date })
await step.waitUntil('scheduled-step', new Date('2025-06-01'));
await step.waitUntil('scheduled-step', '2025-06-01T12:00:00.000Z');
await step.waitUntil('scheduled-step', { date: new Date('2025-06-01') });

// Delay for a duration (string or object). sleep is an alias of delay.
await step.delay('cool-off', '3 days');
await step.delay('cool-off', { days: 3 });
await step.delay('ramp-up', '2 days 12 hours');
await step.sleep('backoff', '1 hour');
```

### Resource ID

The optional `resourceId` associates a workflow run with an external entity in your application - a user, an order, a subscription, or any domain object the workflow operates on. It serves two purposes:

1. **Association** - Links each workflow run to the business entity it belongs to, so you can query all runs for a given resource.
2. **Scoping** - When provided, all read and write operations (get, update, pause, resume, cancel, trigger events) include `resource_id` in their database queries, ensuring you only access workflow runs that belong to that resource. This is useful for enforcing tenant isolation or ownership checks.

`resourceId` is optional on every API method. If you don't need to group or scope runs by an external entity, you can omit it entirely and use `runId` alone.

```typescript
// Start a workflow scoped to a specific user
const run = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  resourceId: 'user-123',          // ties this run to user-123
  input: { email: 'user@example.com' },
});

// Later, list all workflow runs for that user
const { items } = await engine.getRuns({
  resourceId: 'user-123',
});
```

### Pause and Resume

Manually pause a workflow and resume it later:

```typescript
// Pause inside a workflow
await step.pause('pause-step');

// Resume from outside the workflow
await engine.resumeWorkflow({
  runId: run.id,
  resourceId: 'resource-123',
});
```

### Fast-Forward

Skip the current waiting step and immediately resume execution. `fastForwardWorkflow` inspects the paused step and dispatches the right internal action — `triggerEvent` for `waitFor`, timeout triggers for `delay`/`waitUntil`, resume for `pause`, and direct output writes for `poll`. If the workflow is not paused, it's a no-op.

This is useful for testing, debugging, or manually advancing workflows past long waits.

```typescript
// Fast-forward a waitFor step, providing mock event data
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
  data: { approved: true, reviewer: 'admin' },
});

// Fast-forward a delay/waitUntil step (no data needed)
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
});

// Fast-forward a poll step with mock result data
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
  data: { paymentId: 'pay_123', status: 'completed' },
});
```

| Paused step type | Behavior |
|------------------|----------|
| `step.waitFor()` | Triggers the event with `data` (defaults to `{}`) |
| `step.delay()` / `step.waitUntil()` | Triggers the timeout event to skip the wait |
| `step.poll()` | Writes `data` as the poll result and triggers resolution |
| `step.pause()` | Delegates to `resumeWorkflow()` |

---

## Examples

### Conditional Steps

```typescript
const conditionalWorkflow = workflow('conditional', async ({ step }) => {
  const data = await step.run('fetch-data', async () => {
    return { isPremium: true };
  });

  if (data.isPremium) {
    await step.run('premium-action', async () => {
      // Only runs for premium users
    });
  }
});
```

### Batch Processing with Loops

```typescript
const batchWorkflow = workflow('batch-process', async ({ step }) => {
  const items = await step.run('get-items', async () => {
    return [1, 2, 3, 4, 5];
  });

  for (const item of items) {
    await step.run(`process-${item}`, async () => {
      // Each item is processed durably
      return processItem(item);
    });
  }
});
```

### Scheduled Reminder with Delay

```typescript
const reminderWorkflow = workflow('send-reminder', async ({ step, input }) => {
  await step.run('send-initial', async () => {
    return await sendEmail(input.email, 'Welcome!');
  });
  // Pause for 3 days, then send follow-up (durable - survives restarts)
  await step.delay('cool-off', '3 days');
  await step.run('send-follow-up', async () => {
    return await sendEmail(input.email, 'Here’s a reminder…');
  });
}, { inputSchema: z.object({ email: z.string().email() }) });
```

### Polling Until a Condition Is Met

```typescript
const paymentWorkflow = workflow('await-payment', async ({ step, input }) => {
  const result = await step.poll(
    'wait-for-payment',
    async () => {
      const payment = await getPaymentStatus(input.paymentId);
      return payment.completed ? payment : false;
    },
    { interval: '1 minute', timeout: '24 hours' },
  );

  if (result.timedOut) {
    return { status: 'expired' };
  }

  return { status: 'paid', payment: result.data };
});
```

`conditionFn` returns `false` to keep polling, or a truthy value to resolve the step. The minimum interval is 30s (default). If `timeout` is omitted the step polls indefinitely.

### Error Handling with Retries

```typescript
const resilientWorkflow = workflow('resilient', async ({ step }) => {
  await step.run('risky-operation', async () => {
    // Retries up to 3 times with exponential backoff
    return await riskyApiCall();
  });
}, {
  retries: 3,
  timeout: 60000,
});
```

### Monitoring Workflow Progress

```typescript
const progress = await engine.checkProgress({
  runId: run.id,
  resourceId: 'resource-123',
});

console.log({
  status: progress.status,
  completionPercentage: progress.completionPercentage,
  completedSteps: progress.completedSteps,
  totalSteps: progress.totalSteps,
});
```

---

## API Reference

### WorkflowEngine

#### Constructor

```typescript
// With connection string (engine creates and owns the pool)
const engine = new WorkflowEngine({
  connectionString: string,          // PostgreSQL connection string
  workflows?: WorkflowDefinition[],  // Optional: register workflows on init
  logger?: WorkflowLogger,           // Optional: custom logger
  boss?: PgBoss,                     // Optional: bring your own pg-boss instance
});

// With existing pool (you manage the pool lifecycle)
const engine = new WorkflowEngine({
  pool: pg.Pool,                     // Your pg.Pool instance
  workflows?: WorkflowDefinition[],
  logger?: WorkflowLogger,
  boss?: PgBoss,
});
```

Pass either `connectionString` or `pool` (exactly one). When `connectionString` is used, the engine creates the pool internally and closes it on `stop()`.

When `boss` is omitted, pg-boss is created automatically with an isolated schema (`pgboss_v12_pgworkflow`) to avoid conflicts with other pg-boss installations.

#### Methods

| Method | Description |
|--------|-------------|
| `start(asEngine?, options?)` | Start the engine and workers |
| `stop()` | Stop the engine gracefully |
| `registerWorkflow(definition)` | Register a workflow definition |
| `startWorkflow({ workflowId, resourceId?, input, options? })` | Start a new workflow run. `resourceId` optionally ties the run to an external entity (see [Resource ID](#resource-id)). |
| `pauseWorkflow({ runId, resourceId? })` | Pause a running workflow |
| `resumeWorkflow({ runId, resourceId?, options? })` | Resume a paused workflow |
| `cancelWorkflow({ runId, resourceId? })` | Cancel a workflow |
| `triggerEvent({ runId, resourceId?, eventName, data?, options? })` | Send an event to a workflow |
| `fastForwardWorkflow({ runId, resourceId?, data? })` | Skip the current waiting step and resume execution |
| `getRun({ runId, resourceId? })` | Get workflow run details |
| `checkProgress({ runId, resourceId? })` | Get workflow progress |
| `getRuns(filters)` | List workflow runs with pagination |

### workflow()

```typescript
workflow<I extends Parameters>(
  id: string,
  handler: (context: WorkflowContext) => Promise<unknown>,
  options?: {
    inputSchema?: I,
    timeout?: number,
    retries?: number,
  }
): WorkflowDefinition<I>
```

### WorkflowContext

The context object passed to workflow handlers:

```typescript
{
  input: T,                    // Validated input data
  workflowId: string,          // Workflow ID
  runId: string,               // Unique run ID
  timeline: Record<string, unknown>, // Step execution history
  logger: WorkflowLogger,      // Logger instance
  step: {
    run: <T>(stepId, handler) => Promise<T>,
    // without timeout: always returns event data T
    waitFor: <T>(stepId, { eventName, schema? }) => Promise<T>,
    // with timeout: returns event data T or undefined if timeout fires first
    waitFor: <T>(stepId, { eventName, timeout, schema? }) => Promise<T | undefined>,
    waitUntil: (stepId, date | dateString | { date }) => Promise<void>,
    delay: (stepId, duration) => Promise<void>,
    sleep: (stepId, duration) => Promise<void>,
    pause: (stepId) => Promise<void>,
    poll: <T>(stepId, conditionFn, { interval?, timeout? }) => Promise<{ timedOut: false; data: T } | { timedOut: true }>,
  }
}
```

`duration` is a string (e.g. `'3 days'`, `'2h'`) or an object (`{ weeks?, days?, hours?, minutes?, seconds? }`). See the `Duration` type and `parseDuration` from the package.

### WorkflowStatus

```typescript
enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `WORKFLOW_RUN_WORKERS` | Number of worker processes | `3` |
| `WORKFLOW_RUN_EXPIRE_IN_SECONDS` | Job expiration time in seconds | `300` |

### Database Setup

The engine automatically runs migrations on startup to create the required tables:

- `workflow_runs` - Stores workflow execution state, step results, and timeline in the `public` schema. The optional `resource_id` column (indexed) associates each run with an external entity in your application. See [Resource ID](#resource-id).
- `pgboss_v12_pgworkflow.*` - pg-boss job queue tables for reliable task scheduling (isolated schema to avoid conflicts)

---

## The PostgreSQL-for-Everything Philosophy

As championed by [postgresforeverything.com](https://postgresforeverything.com/), PostgreSQL is one of the most reliable, feature-rich, and cost-effective databases ever built. pg-workflows embraces this philosophy:

- **One database to rule them all** - Your application data and workflow state live in the same PostgreSQL instance. No distributed systems headaches.
- **Battle-tested reliability** - PostgreSQL's ACID transactions guarantee your workflow state is always consistent.
- **Zero operational overhead** - No Redis cluster to manage. No message broker to monitor. No external service to pay for.
- **Full queryability** - Inspect, debug, and analyze workflow runs with plain SQL.

If you're already running Postgres (and you probably should be), adding durable workflows is as simple as:

```bash
npm install pg-workflows pg
```

---

## Requirements

- Node.js >= 18.0.0
- PostgreSQL >= 10
- `pg` >= 8.0.0 (peer dependency)
- `zod` >= 3.0.0 (optional peer dependency, needed only if using `inputSchema`)

## Acknowledgments

Special thanks to the teams behind [Temporal](https://temporal.io/), [Inngest](https://www.inngest.com/), [Trigger.dev](https://trigger.dev/), and [DBOS](https://www.dbos.dev/) for pioneering durable execution patterns and inspiring this project.

## License

MIT
