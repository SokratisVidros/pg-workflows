# pg-workflows

Durable execution built on pg-boss — like Temporal, Inngest, or Trigger, powered by Postgres.

## Features

- **Durable Execution**: Workflows survive crashes and restarts by persisting state in PostgreSQL
- **Step-by-Step Execution**: Break complex workflows into discrete, resumable steps
- **Event-Driven**: Wait for external events with `step.waitFor()` to pause and resume workflows
- **Built-in Retries**: Configure automatic retries with exponential backoff
- **Timeouts**: Set workflow-level and step-level timeouts
- **Progress Tracking**: Monitor workflow completion percentage and step progress
- **Type-Safe**: Full TypeScript support with Zod schema validation
- **Powered by PostgreSQL**: Leverages pg-boss for reliable job queuing

## Installation

```bash
npm install pg-workflows
# or
yarn add pg-workflows
# or
bun add pg-workflows
```

## Quick Start

```typescript
import { WorkflowEngine, workflow } from 'pg-workflows';
import PgBoss from 'pg-boss';
import { z } from 'zod';

// Define your workflow
const sendWelcomeEmail = workflow(
  'send-welcome-email',
  async (ctx) => {
    // Step 1: Create user record
    const user = await ctx.step.run('create-user', async () => {
      return { id: '123', email: ctx.input.email };
    });

    // Step 2: Send email
    await ctx.step.run('send-email', async () => {
      await sendEmail(user.email, 'Welcome!');
    });

    // Step 3: Wait for user confirmation
    const confirmation = await ctx.step.waitFor('wait-confirmation', {
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

// Initialize pg-boss
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
});

// Initialize the engine
const engine = new WorkflowEngine({
  boss,
  workflows: [sendWelcomeEmail],
});

// Start the engine
await engine.start();

// Start a workflow run
const run = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  resourceId: 'user-123',
  input: { email: 'user@example.com' },
});

// Trigger an event to resume the workflow
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

## Core Concepts

### Workflows

A workflow is a durable function that can be paused and resumed. Define workflows using the `workflow()` function:

```typescript
const myWorkflow = workflow(
  'workflow-id',
  async (ctx) => {
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

Steps are the building blocks of workflows. Each step is executed exactly once, even if the workflow is retried:

```typescript
await ctx.step.run('step-id', async () => {
  // Step logic - this will only execute once
  return { result: 'data' };
});
```

### Event-Driven Workflows

Wait for external events to pause and resume workflows:

```typescript
const eventData = await ctx.step.waitFor('wait-step', {
  eventName: 'payment-completed',
  timeout: 5 * 60 * 1000, // 5 minutes
});
```

### Pause and Resume

Manually pause a workflow and resume it later:

```typescript
// Pause
await ctx.step.pause('pause-step');

// Resume from outside the workflow
await engine.resumeWorkflow({
  runId: run.id,
  resourceId: 'resource-123',
});
```

## API Reference

### WorkflowEngine

#### Constructor

```typescript
const engine = new WorkflowEngine({
  boss: PgBoss,                     // Required: pg-boss instance
  workflows: WorkflowDefinition[], // Optional: register workflows on init
  logger: WorkflowLogger,           // Optional: custom logger
});
```

#### Methods

- **`start(asEngine?: boolean, options?)`** - Start the engine and workers
- **`stop()`** - Stop the engine gracefully
- **`registerWorkflow(definition)`** - Register a workflow
- **`startWorkflow({ workflowId, resourceId?, input, options? })`** - Start a workflow run
- **`pauseWorkflow({ runId, resourceId? })`** - Pause a running workflow
- **`resumeWorkflow({ runId, resourceId?, options? })`** - Resume a paused workflow
- **`cancelWorkflow({ runId, resourceId? })`** - Cancel a workflow
- **`triggerEvent({ runId, resourceId?, eventName, data?, options? })`** - Send an event to a workflow
- **`getRun({ runId, resourceId? })`** - Get workflow run details
- **`checkProgress({ runId, resourceId? })`** - Get workflow progress
- **`getRuns(filters)`** - List workflow runs with pagination

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
    waitFor: <T>(stepId, { eventName, timeout?, schema? }) => Promise<T>,
    waitUntil: (stepId, { date }) => Promise<void>,
    pause: (stepId) => Promise<void>,
  }
}
```

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

## Configuration

### Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `WORKFLOW_RUN_WORKERS` - Number of worker processes (default: 3)
- `WORKFLOW_RUN_EXPIRE_IN_SECONDS` - Job expiration time (default: 300)

### Database Setup

The engine automatically runs migrations on startup to create the required tables:
- `workflow_runs` - Stores workflow execution state
- `pgboss.*` - pg-boss job queue tables

## Examples

### Conditional Steps

```typescript
const workflow = workflow('conditional', async (ctx) => {
  const data = await ctx.step.run('fetch-data', async () => {
    return { isPremium: true };
  });

  if (data.isPremium) {
    await ctx.step.run('premium-action', async () => {
      // Only runs for premium users
    });
  }
});
```

### Loops

```typescript
const workflow = workflow('batch-process', async (ctx) => {
  const items = await ctx.step.run('get-items', async () => {
    return [1, 2, 3, 4, 5];
  });

  for (const item of items) {
    await ctx.step.run(`process-${item}`, async () => {
      // Process each item durably
      return processItem(item);
    });
  }
});
```

### Error Handling

```typescript
const workflow = workflow('resilient', async (ctx) => {
  await ctx.step.run('risky-operation', async () => {
    // This will retry up to 3 times with exponential backoff
    return await riskyApiCall();
  });
}, {
  retries: 3,
  timeout: 60000,
});
```

### Monitoring Progress

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

## Requirements

- Node.js >= 18.0.0
- PostgreSQL >= 10
- pg-boss >= 10.0.0

## License

MIT

