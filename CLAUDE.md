# CLAUDE.md - pg-workflows

This file provides guidance to Claude Code when working with the pg-workflows codebase.

## What is pg-workflows?

pg-workflows is a TypeScript workflow engine that uses PostgreSQL for durable execution, event-driven orchestration, and automatic retries. It requires no extra infrastructure beyond PostgreSQL. Built on top of pg-boss for reliable job scheduling.

- **Package:** `pg-workflows` (npm)
- **Language:** TypeScript (ESM + CJS dual output)
- **Runtime:** Node.js >= 18
- **Database:** PostgreSQL >= 10
- **License:** MIT

## Project Structure

```
src/
├── index.ts          # Public API re-exports
├── definition.ts     # workflow() factory function
├── engine.ts         # WorkflowEngine class (core orchestrator)
├── types.ts          # All public types, enums, interfaces
├── error.ts          # Error classes
├── ast-parser.ts     # Static analysis of workflow handlers
├── db/
│   ├── index.ts      # DB module exports
│   ├── types.ts      # WorkflowRun type
│   ├── queries.ts    # Database query functions
│   └── migration.ts  # Schema migrations
└── tests/            # Test utilities
examples/
├── basic.ts          # Example usage
└── cron.ts           # Cron workflow example
```

## Commands

- `npm run build` - Build with bunup
- `npm run dev` - Watch mode build
- `npm test` - Run tests with vitest
- `npm run test:run` - Run tests once
- `npm run lint` - Lint with Biome
- `npm run lint:fix` - Auto-fix lint issues
- `npm run format` - Format with Biome

## Code Conventions

- **Linter/Formatter:** Biome (not ESLint/Prettier)
- **Test framework:** Vitest
- **Build tool:** bunup
- **Module system:** ESM-first with CJS compatibility
- **Validation:** Zod for input schemas
- **IDs:** KSUID for workflow run IDs
- **No semicolons in code** - follow the existing Biome config

## Core API

### `workflow(id, handler, options?)` - Define a workflow

```typescript
import { workflow } from 'pg-workflows';
import { z } from 'zod';

const myWorkflow = workflow(
  'workflow-id',                              // unique string ID
  async ({ step, input, runId, workflowId, timeline, logger, schedule }) => {
    // workflow body with step calls
    // `schedule` is populated for cron-triggered runs
  },
  {
    inputSchema: z.object({ /* ... */ }),      // optional Zod schema
    timeout: 60000,                            // optional, milliseconds
    retries: 3,                                // optional, max retry count
    cron: '*/15 * * * *',                         // cron expression string (UTC)
    // or: cron: { expression: '*/15 * * * *', timezone: 'America/New_York' },
  }
);
```

### `WorkflowEngine` - Main orchestrator

```typescript
import { WorkflowEngine } from 'pg-workflows';
import PgBoss from 'pg-boss';

const engine = new WorkflowEngine({
  boss: pgBossInstance,                        // required
  workflows: [myWorkflow],                     // optional, register on init
  logger: { log: console.log, error: console.error }, // optional
});

await engine.start();           // starts boss, runs migrations, creates workers
await engine.stop();            // graceful shutdown
```

### Step Types (available on `context.step`)

#### `step.run(stepId, handler)` - Execute a durable step
```typescript
const result = await step.run('step-name', async () => {
  // Runs exactly once; result is persisted in PostgreSQL
  return { data: 'value' };
});
```

#### `step.waitFor(stepId, { eventName, timeout?, schema? })` - Wait for external event
```typescript
const eventData = await step.waitFor('wait-step', {
  eventName: 'payment-completed',    // event name to listen for
  timeout: 5 * 60 * 1000,           // optional timeout in ms
  schema: z.object({ /* ... */ }),   // optional Zod schema for event data
});
```

#### `step.pause(stepId)` - Manually pause the workflow
```typescript
await step.pause('approval-gate');
// Workflow pauses here until engine.resumeWorkflow() is called
```

#### `step.waitUntil(stepId, { date })` - Wait until a specific date
```typescript
await step.waitUntil('scheduled-step', { date: new Date('2025-01-01') });
```

### Engine Methods

```typescript
// Start a workflow run
const run = await engine.startWorkflow({
  workflowId: 'workflow-id',
  resourceId: 'user-123',            // optional, for scoping/multi-tenancy
  input: { email: 'user@example.com' },
  options: { timeout, retries, expireInSeconds, batchSize }, // all optional
});

// Pause / Resume / Cancel
await engine.pauseWorkflow({ runId: run.id, resourceId: 'user-123' });
await engine.resumeWorkflow({ runId: run.id, resourceId: 'user-123' });
await engine.cancelWorkflow({ runId: run.id, resourceId: 'user-123' });

// Send event to a waiting workflow
await engine.triggerEvent({
  runId: run.id,
  resourceId: 'user-123',
  eventName: 'user-confirmed',
  data: { confirmedAt: new Date() },  // optional
});

// Query runs
const run = await engine.getRun({ runId, resourceId });
const progress = await engine.checkProgress({ runId, resourceId });
const { items, nextCursor, hasMore } = await engine.getRuns({
  resourceId: 'user-123',
  statuses: [WorkflowStatus.RUNNING],
  workflowId: 'workflow-id',
  limit: 20,
  startingAfter: cursor,
});

// Register/unregister workflows dynamically
await engine.registerWorkflow(workflowDefinition);
await engine.unregisterWorkflow('workflow-id');
await engine.unregisterAllWorkflows();
```

## Key Types

```typescript
enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

enum StepType {
  PAUSE = 'pause',
  RUN = 'run',
  WAIT_FOR = 'waitFor',
  WAIT_UNTIL = 'waitUntil',
}

type WorkflowRun = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  resourceId: string | null;
  workflowId: string;
  status: WorkflowStatus;
  input: unknown;
  output: unknown | null;
  error: string | null;
  currentStepId: string;
  timeline: Record<string, unknown>;
  pausedAt: Date | null;
  resumedAt: Date | null;
  completedAt: Date | null;
  timeoutAt: Date | null;
  retryCount: number;
  maxRetries: number;
  jobId: string | null;
  cron: string | null;
  timezone: string | null;
};

type WorkflowRunProgress = WorkflowRun & {
  completionPercentage: number;
  totalSteps: number;
  completedSteps: number;
};

// Error classes
class WorkflowEngineError extends Error {
  workflowId?: string;
  runId?: string;
  cause?: Error;
}
class WorkflowRunNotFoundError extends WorkflowEngineError {}
```

## Environment Variables

| Variable                          | Description                     | Default |
|-----------------------------------|---------------------------------|---------|
| `DATABASE_URL`                    | PostgreSQL connection string    | required |
| `WORKFLOW_RUN_WORKERS`            | Number of worker processes      | `3`     |
| `WORKFLOW_RUN_EXPIRE_IN_SECONDS`  | Job expiration time in seconds  | `300`   |

## Cron Workflows

Workflows can be scheduled to run on a cron expression using the `cron` option. The engine uses pg-boss `schedule()` under the hood.

### CronConfig

The `cron` option accepts a string or an object:

```typescript
// String shorthand (defaults to UTC)
cron: '*/15 * * * *'

// Object with explicit timezone
cron: { expression: '*/15 * * * *', timezone: 'America/New_York' }

type CronConfig = {
  expression: string;     // standard cron expression
  timezone?: string;      // IANA timezone, defaults to 'UTC'
};
```

### ScheduleContext

Cron-triggered runs receive a `schedule` object on the workflow context. The `timestamp` is derived from `run.createdAt` and `lastTimestamp` is queried from the latest completed run at execution time.

```typescript
type ScheduleContext = {
  timestamp: Date;              // when this cron trigger fired
  lastTimestamp: Date | undefined; // when the last successful cron run completed
  timezone: string;             // the configured timezone
};
```

### Cron workflow example

```typescript
const sync = workflow('sync-data', async ({ step, schedule, logger }) => {
  const since = schedule?.lastTimestamp ?? new Date(0);
  const data = await step.run('fetch', async () => fetchSince(since));
  await step.run('write', async () => writeToDB(data));
  return { synced: data.length };
}, {
  cron: '*/15 * * * *',  // every 15 minutes, UTC
  retries: 3,
});
```

### Post-start registration

Calling `engine.registerWorkflow()` after `engine.start()` will automatically set up the cron schedule if the workflow has a `cron` config.

## AI & Agent Workflow Patterns

pg-workflows is well-suited for AI agents and LLM pipelines because LLM calls are slow, expensive, and unreliable - exactly the work that benefits most from durable execution.

### Why durable execution matters for AI

- **Cached step results** - If a process crashes after an expensive LLM call, the result is already persisted. On retry, it skips and resumes from the next step.
- **Automatic retries** - LLM APIs return 429s and 500s. Built-in exponential backoff handles transient failures.
- **Human-in-the-loop** - Pause with `step.waitFor()` to wait for human review/approval, consuming zero resources while waiting.
- **Observable progress** - Track agent progress and inspect intermediate results via `checkProgress()`.
- **Long-running agents** - Multi-step agents that run for minutes/hours persist state and resume without holding connections.

### Multi-step AI agent pattern

```typescript
const agent = workflow('research-agent', async ({ step, input }) => {
  const plan = await step.run('plan', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: `Plan research for: ${input.topic}` }] });
  });

  const findings = [];
  for (const task of plan.tasks) {
    const result = await step.run(`research-${task.id}`, async () => {
      return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: task.description }] });
    });
    findings.push(result);
  }

  const report = await step.run('synthesize', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: `Synthesize: ${JSON.stringify(findings)}` }] });
  });

  return { plan, findings, report };
}, { retries: 3, timeout: 30 * 60 * 1000 });
```

### Human-in-the-loop AI pattern

```typescript
const pipeline = workflow('content-pipeline', async ({ step, input }) => {
  const draft = await step.run('generate', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: `Write about: ${input.topic}` }] });
  });

  // Pause for human review - zero cost while waiting
  const review = await step.waitFor('human-review', {
    eventName: 'content-reviewed',
    timeout: 7 * 24 * 60 * 60 * 1000,
  });

  if (review.approved) return { status: 'published', content: draft };

  const revision = await step.run('revise', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: `Revise: ${draft}\nFeedback: ${review.feedback}` }] });
  });
  return { status: 'revised', content: revision };
}, { retries: 3 });

// Trigger the review event from your API
await engine.triggerEvent({ runId, eventName: 'content-reviewed', data: { approved: false, feedback: '...' } });
```

### RAG pipeline pattern

```typescript
const rag = workflow('rag-agent', async ({ step, input }) => {
  const embedding = await step.run('embed', async () => {
    return await openai.embeddings.create({ model: 'text-embedding-3-small', input: input.query });
  });
  const docs = await step.run('search', async () => {
    return await vectorStore.search(embedding, { topK: 10 });
  });
  const answer = await step.run('generate', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [
      { role: 'system', content: `Context:\n${docs.map(d => d.text).join('\n')}` },
      { role: 'user', content: input.query },
    ]});
  });
  return { answer, sources: docs };
}, { retries: 3, timeout: 5 * 60 * 1000 });
```

## Important Patterns

1. **Step IDs must be unique within a workflow.** When using loops, use dynamic IDs: `step.run(\`process-${item.id}\`, ...)`
2. **Step results are cached.** On retry, completed steps return their persisted result without re-executing.
3. **`resourceId` is optional** but useful for multi-tenant scoping and querying runs by external entity.
4. **Workflow handlers are statically analyzed** at registration time to extract step definitions (conditional, loop, dynamic).
5. **Migrations run automatically** on `engine.start()` - no manual schema setup needed.
6. **The engine uses pg-boss** for job queuing but manages its own retry logic with exponential backoff (`2^retryCount * 1000ms`).
