# API Reference

## WorkflowEngine

The full engine — registers workflows, runs workers, and executes steps. Use in your **worker service** or in a **single-service** setup.

### Constructor

```typescript
// With connection string (engine creates and owns the pool)
const engine = new WorkflowEngine({
  connectionString: string,          // PostgreSQL connection string
  workflows?: WorkflowDefinition[],  // Optional: register workflows on init
  logger?: WorkflowLogger,           // Optional: custom logger
  boss?: PgBoss,                     // Optional: bring your own pg-boss instance
})

// With existing pool (you manage the pool lifecycle)
const engine = new WorkflowEngine({
  pool: pg.Pool,                     // Your pg.Pool instance
  workflows?: WorkflowDefinition[],
  logger?: WorkflowLogger,
  boss?: PgBoss,
})
```

Pass either `connectionString` or `pool` (exactly one). When `connectionString` is used, the engine creates the pool internally and closes it on `stop()`.

When `boss` is omitted, pg-boss is created automatically with an isolated schema (`pgboss_v12_pgworkflow`) to avoid conflicts with other pg-boss installations.

### Methods

| Method | Description |
|--------|-------------|
| `start(asEngine?, options?)` | Start the engine and workers |
| `stop()` | Stop the engine gracefully |
| `registerWorkflow(definition)` | Register a workflow definition |
| `startWorkflow(ref, input, options?)` | Start a top-level workflow run using a typed ref (see [WorkflowRef](#workflowref)) |
| `startWorkflow({ workflowId, resourceId?, input, idempotencyKey?, options? })` | Start a top-level workflow run by ID. `resourceId` optionally ties the run to an external entity (see [Resource ID](core-concepts.md#resource-id)). `idempotencyKey` optionally deduplicates starts (see [Idempotency Key](core-concepts.md#idempotency-key)). |
| `pauseWorkflow({ runId, resourceId? })` | Pause a running workflow |
| `resumeWorkflow({ runId, resourceId?, options? })` | Resume a paused workflow. No-ops for `step.invokeChildWorkflow()` waits. |
| `cancelWorkflow({ runId, resourceId? })` | Cancel a workflow |
| `triggerEvent({ runId, resourceId?, eventName, data?, options? })` | Send an event to a workflow |
| `fastForwardWorkflow({ runId, resourceId?, data? })` | Skip the current waiting step and resume execution. No-ops for `step.invokeChildWorkflow()` waits. |
| `getRun({ runId, resourceId? })` | Get workflow run details |
| `checkProgress({ runId, resourceId? })` | Get workflow progress |
| `getRuns(filters)` | List workflow runs with pagination |

## WorkflowClient

A lightweight client for **API services** in a microservices setup. Starts and manages workflow runs without importing handler code. Import from `pg-workflows/client`.

### Constructor

```typescript
import { WorkflowClient } from 'pg-workflows/client'

const client = new WorkflowClient({
  connectionString: string,  // or pool: pg.Pool
  logger?: WorkflowLogger,
})
```

### Methods

| Method | Description |
|--------|-------------|
| `start()` | Connect to the database (called automatically on first use) |
| `stop()` | Close the connection |
| `startWorkflow(ref, input, options?)` | Start a top-level workflow run using a typed ref |
| `startWorkflow({ workflowId, input, resourceId?, options? })` | Start a top-level workflow run by ID |
| `pauseWorkflow({ runId, resourceId? })` | Pause a running workflow |
| `resumeWorkflow({ runId, resourceId?, options? })` | Resume a paused workflow. No-ops for `step.invokeChildWorkflow()` waits. |
| `cancelWorkflow({ runId, resourceId? })` | Cancel a workflow |
| `triggerEvent({ runId, resourceId?, eventName, data?, options? })` | Send an event to a workflow |
| `fastForwardWorkflow({ runId, resourceId?, data? })` | Skip the current waiting step. No-ops for `step.invokeChildWorkflow()` waits. |
| `getRun({ runId, resourceId? })` | Get workflow run details |
| `checkProgress({ runId, resourceId? })` | Get workflow progress |
| `getRuns(filters)` | List workflow runs with pagination |

## WorkflowRef

A lightweight, callable reference that carries a workflow's ID and input schema without any handler code. Created with `createWorkflowRef()` (importable from `pg-workflows/client`) or `workflow.ref()`.

```typescript
import { createWorkflowRef } from 'pg-workflows/client'
import { z } from 'zod'

// Create a ref — just an ID + schema, no handler
const myWorkflow = createWorkflowRef('my-workflow', {
  inputSchema: z.object({ email: z.string().email() }),
})

// Use in API service — type-safe input
await client.startWorkflow(myWorkflow, { email: 'user@example.com' })

// Use in worker service — call with a handler to get a full definition
const definition = myWorkflow(async ({ step, input }) => {
  await step.run('do-work', async () => {
    /* ... */
  })
})
```

Refs can also carry an output type for `step.invokeChildWorkflow()`:

```typescript
type ChildOutput = { ok: true }
const childWorkflow = createWorkflowRef<ChildOutput>('child-workflow')

const output = await step.invokeChildWorkflow('call-child', childWorkflow, {})
// output is ChildOutput
```

## workflow()

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

## WorkflowContext

The context object passed to workflow handlers:

```typescript
{
  input: T,                          // Validated input data
  workflowId: string,                // Workflow ID
  runId: string,                     // Unique run ID
  timeline: Record<string, unknown>, // Step execution history
  logger: WorkflowLogger,            // Logger instance
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
    // invokeChildWorkflow has two overloads:
    //   1) by typed `WorkflowRef<TInput, TOutput>` - return type is inferred
    invokeChildWorkflow: <TInput, TOutput>(stepId, ref: WorkflowRef<TInput, TOutput>, input, options?) => Promise<TOutput>,
    //   2) by workflow ID - explicit `<TOutput>` generic for the return
    invokeChildWorkflow: <TOutput>(stepId, { workflowId, input, resourceId?, idempotencyKey?, options? }) => Promise<TOutput>,
  }
}
```

`startWorkflow()` creates a top-level run and returns immediately. `step.invokeChildWorkflow()` starts a child run from inside a workflow, pauses the parent, and resolves with the child output when the child reaches a terminal state.

`duration` is a string (e.g. `'3 days'`, `'2h'`) or an object (`{ weeks?, days?, hours?, minutes?, seconds? }`). See the `Duration` type and `parseDuration` from the package.

## WorkflowStatus

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
