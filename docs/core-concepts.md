# Core Concepts

## Workflows

A workflow is a durable function that breaks complex operations into discrete, resumable steps. Define workflows using the `workflow()` function:

```typescript
const myWorkflow = workflow(
  'workflow-id',
  async ({ step, input }) => {
    // Your workflow logic here
  },
  {
    inputSchema: mySchema, // any Standard Schema-compliant schema
    timeout: 60000,        // milliseconds
    retries: 3,
  },
)
```

## Steps

Steps are the building blocks of durable workflows. Each step is executed **exactly once**, even if the workflow is retried:

```typescript
await step.run('step-id', async () => {
  // This will only execute once — the result is persisted in Postgres
  return { result: 'data' }
})
```

**Step IDs must be unique within a workflow.** When using loops, use dynamic IDs: `step.run(\`process-${item.id}\`, ...)`.

## Event-Driven Steps

Wait for external events to pause and resume workflows without consuming resources:

```typescript
const eventData = await step.waitFor('wait-step', {
  eventName: 'payment-completed',
  timeout: 5 * 60 * 1000, // 5 minutes
})
```

Send events from outside the workflow:

```typescript
await engine.triggerEvent({
  runId: run.id,
  eventName: 'payment-completed',
  data: { amount: 99 },
})
```

## Scheduled & Delay Steps

Wait until a specific time, or delay for a duration (sugar over `waitUntil`). If the date is in the past, the step runs immediately.

```typescript
// Wait until a specific date (Date, ISO string, or { date })
await step.waitUntil('scheduled-step', new Date('2025-06-01'))
await step.waitUntil('scheduled-step', '2025-06-01T12:00:00.000Z')
await step.waitUntil('scheduled-step', { date: new Date('2025-06-01') })

// Delay for a duration (string or object). sleep is an alias of delay.
await step.delay('cool-off', '3 days')
await step.delay('cool-off', { days: 3 })
await step.delay('ramp-up', '2 days 12 hours')
await step.sleep('backoff', '1 hour')
```

## Polling Steps

Repeatedly check a condition until it returns a truthy value or a timeout expires:

```typescript
const result = await step.poll(
  'wait-for-payment',
  async () => {
    const payment = await getPaymentStatus(input.paymentId)
    return payment.completed ? payment : false
  },
  { interval: '1 minute', timeout: '24 hours' },
)

if (result.timedOut) {
  return { status: 'expired' }
}

return { status: 'paid', payment: result.data }
```

`conditionFn` returns `false` to keep polling, or a truthy value to resolve the step. The minimum interval is 30s (default). If `timeout` is omitted the step polls indefinitely.

## Resource ID

The optional `resourceId` associates a workflow run with an external entity in your application — a user, an order, a subscription, or any domain object the workflow operates on. It serves two purposes:

1. **Association** — links each workflow run to the business entity it belongs to, so you can query all runs for a given resource.
2. **Scoping** — when provided, all read and write operations (get, update, pause, resume, cancel, trigger events) include `resource_id` in their database queries, ensuring you only access workflow runs that belong to that resource. Useful for enforcing tenant isolation or ownership checks.

`resourceId` is optional on every API method. If you don't need to group or scope runs by an external entity, you can omit it entirely and use `runId` alone.

```typescript
// Start a workflow scoped to a specific user
const run = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  resourceId: 'user-123', // ties this run to user-123
  input: { email: 'user@example.com' },
})

// Later, list all workflow runs for that user
const { items } = await engine.getRuns({
  resourceId: 'user-123',
})
```

## Idempotency Key

Pass an optional `idempotencyKey` to `startWorkflow()` when the same logical start might be requested more than once (user double-clicks, API retries, or at-least-once webhooks). The engine stores the key on the run; a second `startWorkflow` with the **same** key returns the **existing** run and does **not** enqueue a second job.

Keys are **globally unique** in the database (up to 256 characters), not scoped per workflow or resource. Prefer stable, namespaced strings so different workflows never collide — for example `send-welcome-email:order-123` instead of a bare order id.

```typescript
const run = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  input: { email: 'user@example.com' },
  idempotencyKey: 'send-welcome-email:checkout-session_cs_abc123',
})

// Idempotent: returns the same run and run.id as above
const again = await engine.startWorkflow({
  workflowId: 'send-welcome-email',
  input: { email: 'other@example.com' }, // ignored for deduplication
  idempotencyKey: 'send-welcome-email:checkout-session_cs_abc123',
})
```

The returned `WorkflowRun` includes `idempotencyKey` (or `null` if omitted).

## Pause and Resume

Manually pause a workflow and resume it later:

```typescript
// Pause inside a workflow
await step.pause('pause-step')

// Resume from outside the workflow
await engine.resumeWorkflow({
  runId: run.id,
  resourceId: 'resource-123',
})
```

## Fast-Forward

Skip the current waiting step and immediately resume execution. `fastForwardWorkflow` inspects the paused step and dispatches the right internal action — `triggerEvent` for `waitFor`, timeout triggers for `delay`/`waitUntil`, resume for `pause`, and direct output writes for `poll`. If the workflow is not paused, it's a no-op.

Useful for testing, debugging, or manually advancing workflows past long waits.

```typescript
// Fast-forward a waitFor step, providing mock event data
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
  data: { approved: true, reviewer: 'admin' },
})

// Fast-forward a delay/waitUntil step (no data needed)
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
})

// Fast-forward a poll step with mock result data
await engine.fastForwardWorkflow({
  runId: run.id,
  resourceId: 'user-123',
  data: { paymentId: 'pay_123', status: 'completed' },
})
```

| Paused step type | Behavior |
|------------------|----------|
| `step.waitFor()` | Triggers the event with `data` (defaults to `{}`) |
| `step.delay()` / `step.waitUntil()` | Triggers the timeout event to skip the wait |
| `step.poll()` | Writes `data` as the poll result and triggers resolution |
| `step.pause()` | Delegates to `resumeWorkflow()` |

## Input Validation

pg-workflows supports any [Standard Schema](https://github.com/standard-schema/standard-schema)-compliant validation library for `inputSchema` — Zod, Valibot, ArkType, or any library that implements the spec. When a schema is provided, the workflow input is validated before execution and the handler's `input` parameter is fully typed.

### With Zod

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'

const myWorkflow = workflow(
  'user-onboarding',
  async ({ step, input }) => {
    // input is typed as { email: string; name: string }
    await step.run('send-welcome', async () => {
      return await sendEmail(input.email, `Welcome, ${input.name}!`)
    })
  },
  {
    inputSchema: z.object({
      email: z.string().email(),
      name: z.string(),
    }),
  },
)
```

### With Valibot

```typescript
import { workflow } from 'pg-workflows'
import * as v from 'valibot'

const myWorkflow = workflow(
  'user-onboarding',
  async ({ step, input }) => {
    // input is typed as { email: string; name: string }
    await step.run('send-welcome', async () => {
      return await sendEmail(input.email, `Welcome, ${input.name}!`)
    })
  },
  {
    inputSchema: v.object({
      email: v.pipe(v.string(), v.email()),
      name: v.string(),
    }),
  },
)
```

### Without a Schema

When no `inputSchema` is provided, input is not validated and `input` is typed as `unknown`. The engine has no guarantee about the shape of the data — it passes through whatever was provided to `startWorkflow()`. You are responsible for narrowing the type yourself:

```typescript
import { workflow } from 'pg-workflows'

const myWorkflow = workflow(
  'process-order',
  async ({ step, input }) => {
    // Option 1: Type assertion - you trust the caller
    const { orderId, amount } = input as { orderId: string; amount: number }

    await step.run('charge', async () => {
      return await chargeOrder(orderId, amount)
    })
  },
)

const myDefensiveWorkflow = workflow(
  'process-order-safe',
  async ({ step, input }) => {
    // Option 2: Runtime checks - you verify before using
    if (typeof input !== 'object' || input === null) {
      throw new Error('Expected input to be an object')
    }
    const { orderId, amount } = input as Record<string, unknown>
    if (typeof orderId !== 'string' || typeof amount !== 'number') {
      throw new Error('Invalid input shape')
    }

    await step.run('charge', async () => {
      return await chargeOrder(orderId, amount)
    })
  },
)
```

Using an `inputSchema` is recommended — it validates input at the engine boundary before your handler runs, and gives you full type inference with no manual work.
