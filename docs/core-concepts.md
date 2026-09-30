# Core Concepts

The snippets on this page assume an `engine` like the one in the [quickstart](../README.md#quickstart), with each workflow passed to `workflows: [...]`.

- [Workflows](#workflows)
- [Steps](#steps)
- [Events](#events)
- [Timers](#timers)
- [Polling](#polling)
- [Pause and resume](#pause-and-resume)
- [Fast-forward](#fast-forward)
- [Child workflows](#child-workflows)
- [Retries and timeouts](#retries-and-timeouts)
- [Recurring schedules](#recurring-schedules)
- [Priorities](#priorities)
- [Singleton workflows](#singleton-workflows)
- [Resource ID](#resource-id)
- [Idempotency key](#idempotency-key)
- [Input validation](#input-validation)

## Workflows

A workflow is an async function with an ID. Every durable operation inside it goes through `step`.

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'

export const sendInvoice = workflow(
  'send-invoice',
  async ({ step, input }) => {
    const invoice = await step.run('create-invoice', async () => {
      return { id: `inv_${input.orderId}`, total: input.total }
    })
    return invoice
  },
  {
    inputSchema: z.object({ orderId: z.string(), total: z.number() }),
    retries: 3,
  },
)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `inputSchema` | Standard Schema | none | Validates `input` at `startWorkflow` and types it in the handler. See [Input validation](#input-validation). |
| `retries` | `number` | `0` | Retry attempts after a failure. See [Retries and timeouts](#retries-and-timeouts). |
| `timeout` | `number` (ms) | none | Recorded as `run.timeoutAt`. See [Retries and timeouts](#retries-and-timeouts). |
| `priority` | `'high' \| 'normal' \| 'low' \| number` | `'normal'` | Queue priority. See [Priorities](#priorities). |
| `singleton` | `boolean` | `false` | At most one pending or running run. See [Singleton workflows](#singleton-workflows). |
| `schedule` | cron string, duration string, or duration object | none | Starts runs on a recurring schedule. See [Recurring schedules](#recurring-schedules). |
| `timezone` | IANA zone | `'UTC'` | Time zone for cron schedules. |

The handler receives `input`, `step`, `runId`, `workflowId`, `resourceId`, `attempt` (zero-based retry count), `timeline`, `logger`, and `schedule`. The full type is in the [API reference](api-reference.md#workflowcontext).

The handler runs from the top each time the run resumes after a pause or a retry. Completed steps return their saved result without running again, so the code between steps must be deterministic. Put anything with side effects, randomness, or the current time inside a step.

## Steps

`step.run` executes a function once and saves its return value on the run.

```typescript
const user = await step.run('create-user', async () => {
  return { id: 'usr_123', email: input.email }
})
```

- **IDs must be unique within a workflow.** In loops, build the ID from the item: `` step.run(`charge-${order.id}`, ...) ``.
- **Return JSON-serializable values.** Results are stored as `jsonb`. A `Date` comes back as an ISO string when the step is replayed, and class instances lose their prototype. Return plain objects, and use `toISOString()` for dates.
- **A step can run more than once if the process crashes mid-step**, before its result is saved. Make external side effects idempotent, for example by passing an idempotency key to your payment provider.

## Events

`step.waitFor` pauses the run until an event with the matching name arrives. The paused run holds no worker.

```typescript
const payment = await step.waitFor('wait-for-payment', {
  eventName: 'payment-completed',
  schema: z.object({ amount: z.number() }),
})
// payment: { amount: number }
```

Send the event from anywhere that has an engine or client:

```typescript
await engine.triggerEvent({
  runId: run.id,
  eventName: 'payment-completed',
  data: { amount: 99 },
})
```

With `timeout` (in milliseconds), the step resolves to `undefined` if no event arrives in time:

```typescript
const payment = await step.waitFor('wait-for-payment', {
  eventName: 'payment-completed',
  timeout: 24 * 60 * 60 * 1000,
})

if (!payment) {
  return { status: 'expired' }
}
```

`schema` sets the TypeScript type of the result. It is not checked at runtime, so validate `data` before calling `triggerEvent` if it comes from an untrusted source. Without `schema`, the result is `unknown`.

## Timers

`step.waitUntil` pauses until a date. `step.delay` pauses for a duration, and `step.sleep` is an alias for it. A date in the past resumes immediately.

```typescript
await step.waitUntil('send-at-launch', new Date('2026-12-01T09:00:00Z'))
await step.waitUntil('send-at-launch', '2026-12-01T09:00:00Z')
await step.waitUntil('send-at-launch', { date: new Date('2026-12-01T09:00:00Z') })

await step.delay('cool-off', '3 days')
await step.delay('cool-off', { days: 3 })
await step.delay('ramp-up', '2 days 12 hours')
await step.sleep('backoff', '1 hour')
```

A duration is a string (`'90s'`, `'2h'`, `'3 days'`) or an object with any of `weeks`, `days`, `hours`, `minutes`, and `seconds`.

## Polling

`step.poll` calls a function on an interval until it returns a truthy value or the timeout passes. Return `false` to keep polling.

```typescript
const exportJob = workflow(
  'wait-for-export',
  async ({ step, input }) => {
    const result = await step.poll(
      'wait-for-file',
      async () => {
        const response = await fetch(`https://api.example.com/exports/${input.exportId}`)
        const body = (await response.json()) as { status: string; url?: string }
        return body.status === 'ready' ? { url: body.url } : false
      },
      { interval: '1 minute', timeout: '24 hours' },
    )

    if (result.timedOut) {
      return { status: 'expired' }
    }
    return { status: 'ready', url: result.data.url }
  },
  { inputSchema: z.object({ exportId: z.string() }) },
)
```

| Option | Default | Description |
|--------|---------|-------------|
| `interval` | `'30s'` | Time between checks. The minimum is 30 seconds. |
| `timeout` | none | Stops polling and returns `{ timedOut: true }`. Omit it to poll indefinitely. |

The run is paused between checks and holds no worker.

## Pause and resume

`step.pause` pauses the run at that point until something calls `resumeWorkflow`:

```typescript
const publishPost = workflow('publish-post', async ({ step }) => {
  await step.run('render-preview', async () => ({ rendered: true }))
  await step.pause('editor-approval')
  await step.run('publish', async () => ({ published: true }))
})
```

```typescript
await engine.resumeWorkflow({ runId: run.id })
```

`engine.pauseWorkflow({ runId })` pauses a pending or running run from outside. `engine.cancelWorkflow({ runId })` cancels a pending, running, or paused run.

## Fast-forward

`fastForwardWorkflow` completes whatever step the run is paused on. It's intended for tests, debugging, and support tooling. It does nothing if the run isn't paused.

```typescript
// Paused on waitFor: `data` becomes the event payload (default `{}`)
await engine.fastForwardWorkflow({ runId: run.id, data: { approved: true } })

// Paused on delay or waitUntil: skips the wait
await engine.fastForwardWorkflow({ runId: run.id })
```

| Paused on | Effect |
|-----------|--------|
| `step.waitFor()` | Sends the event with `data` (default `{}`). |
| `step.delay()` / `step.waitUntil()` | Ends the wait. |
| `step.poll()` | Resolves the poll with `data` as its result. |
| `step.pause()` | Same as `resumeWorkflow()`. |
| `step.invokeChildWorkflow()` | Nothing. The child's outcome decides when the parent continues. |

## Child workflows

`step.invokeChildWorkflow` starts another workflow, pauses the parent, and returns the child's output when the child completes. The parent holds no worker while it waits.

```typescript
import { createWorkflowRef, workflow } from 'pg-workflows'
import { z } from 'zod'

type ReceiptOutput = { receiptId: string }
const receiptInput = z.object({ orderId: z.string() })

// Explicit generics turn off inference, so pass the schema type as the second one
const sendReceiptRef = createWorkflowRef<ReceiptOutput, typeof receiptInput>('send-receipt', {
  inputSchema: receiptInput,
})

export const sendReceipt = sendReceiptRef(async ({ step, input }) => {
  return step.run('email-receipt', async () => ({ receiptId: `rcpt_${input.orderId}` }))
})

export const checkout = workflow(
  'checkout',
  async ({ step, input }) => {
    const receipt = await step.invokeChildWorkflow('send-receipt', sendReceiptRef, {
      orderId: input.orderId,
    })
    return { receiptId: receipt.receiptId } // receipt: ReceiptOutput
  },
  { inputSchema: z.object({ orderId: z.string() }) },
)
```

Register both `checkout` and `sendReceipt` with the engine. You can also invoke by ID and type the output with a generic:

```typescript
const receipt = await step.invokeChildWorkflow<ReceiptOutput>('send-receipt', {
  workflowId: 'send-receipt',
  input: { orderId: input.orderId },
})
```

Behavior:

- The child starts once per parent step. Its output is saved on the parent like any step result.
- If the child fails or is cancelled, the parent step throws, and the parent's own `retries` apply.
- The child inherits the parent's priority unless the call or the child's definition sets one.
- **Cancelling the parent does not cancel the child.** The child runs to its own end state. The same applies when the parent fails, completes, or times out while the child is running.
- `resumeWorkflow()` and `fastForwardWorkflow()` do nothing while the parent waits on a child.

## Retries and timeouts

When a handler throws, the run is retried up to `retries` times (default `0`). Each retry runs the handler from the top, and completed steps return their saved result, so only the failed step and the steps after it run again. The number of the current attempt is `attempt` on the handler context and `retryCount` on the run.

Retries are scheduled by pg-boss with exponential backoff: roughly 1s, 2s, 4s, 8s, and so on, with up to ±50% jitter. After the last attempt fails, the run's status is `failed` and `error` holds the message.

```typescript
const syncCustomer = workflow(
  'sync-customer',
  async ({ step, input, attempt }) => {
    return step.run('push-to-crm', async () => {
      const response = await fetch('https://crm.example.com/customers', {
        method: 'POST',
        body: JSON.stringify({ id: input.customerId, attempt }),
      })
      if (!response.ok) throw new Error(`CRM returned ${response.status}`)
      return { synced: true }
    })
  },
  { inputSchema: z.object({ customerId: z.string() }), retries: 5 },
)
```

Override `retries` for a single run with `startWorkflow({ options: { retries } })`.

`timeout` (milliseconds, on the workflow or in `startWorkflow` options) is saved on the run as `timeoutAt`. The engine does not currently fail a run that passes `timeoutAt`. To bound a wait, use the `timeout` option of `step.waitFor` or `step.poll`.

A single execution of the handler is also bounded by the job expiry, `WORKFLOW_RUN_EXPIRE_IN_SECONDS` (default 300). Split work that takes longer into several steps. See [Configuration](configuration.md#environment-variables).

## Recurring schedules

Set `schedule` to start a run on a recurring basis. It accepts a cron expression, a duration string, or a duration object.

```typescript
workflow('weekday-report', handler, { schedule: '0 9 * * 1-5', timezone: 'America/New_York' })
workflow('every-5-minutes', handler, { schedule: '5m' })
workflow('hourly', handler, { schedule: '1 hour' })
workflow('daily', handler, { schedule: { days: 1 } })
```

- **Cron vs. duration.** A string of 5 or 6 space-separated fields that uses only cron characters (`0-9 * / , - ? L W #`) is parsed as cron. Anything else is parsed as a duration.
- **Durations must divide evenly.** A duration is converted to cron, so it must be whole minutes that divide 60, whole hours that divide 24, or exactly one day. `'23m'` and `'7h'` throw at registration. Use a cron expression for those.
- **`timezone`** applies to cron only. The default is UTC.
- **A worker must be running.** Scheduled runs are started by an engine that has the workflow registered and has called `engine.start()`.

A scheduled run has `ctx.schedule.timestamp`, the time the schedule fired. A run started with `startWorkflow` has `ctx.schedule === undefined`. For incremental syncs, use the last completed run as a cursor. Read it inside a step so the value stays fixed when the run resumes or retries:

```typescript
import { WorkflowStatus, workflow } from 'pg-workflows'

const syncOrders = workflow(
  'sync-orders',
  async ({ step, schedule, workflowId }) => {
    const since = await step.run('read-cursor', async () => {
      const { items } = await engine.getRuns({
        workflowId,
        statuses: [WorkflowStatus.COMPLETED],
        limit: 1,
      })
      return (items[0]?.completedAt ?? new Date(0)).toISOString()
    })

    const orders = await step.run('fetch-orders', async () => {
      const response = await fetch(`https://shop.example.com/orders?updated_since=${since}`)
      return (await response.json()) as { id: string }[]
    })

    return { firedAt: schedule?.timestamp.toISOString(), since, synced: orders.length }
  },
  { schedule: '5m', singleton: true },
)
```

Don't use `getWorkflowLastRun` for this. It returns the most recently created run of any status, which inside a scheduled run is the current run.

**Overlap.** With `singleton: true`, a scheduled fire is skipped while a previous run is pending or running. Without it, scheduled runs can overlap.

## Priorities

`priority` orders runs in the queue. Higher values run first.

| Value | Integer |
|-------|---------|
| `'high'` | `100` |
| `'normal'` | `0` (default) |
| `'low'` | `-100` |
| any integer | as given |

Set a default on the workflow, and override it for a single run:

```typescript
const billing = workflow('billing', handler, { priority: 'high' })

await engine.startWorkflow({
  workflowId: 'billing',
  input: {},
  options: { priority: 'low' },
})
```

The effective priority is `startWorkflow` option, then the workflow's `priority`, then `'normal'`. It's resolved once when the run is created and saved as `run.priority`. Resumes, retries, and poll checks reuse the saved value.

Child workflows use the call's `options.priority`, then the child definition's `priority`, then the parent run's priority.

## Singleton workflows

`singleton: true` allows at most one pending or running run of a workflow ID. Starting a second run throws `WorkflowRunInProgressError`.

```typescript
import { WorkflowRunInProgressError, workflow } from 'pg-workflows'

const nightlySync = workflow(
  'nightly-sync',
  async ({ step }) => {
    await step.run('pull', async () => ({ pulled: true }))
  },
  { singleton: true },
)

await engine.startWorkflow({ workflowId: 'nightly-sync', input: {} })

try {
  await engine.startWorkflow({ workflowId: 'nightly-sync', input: {} })
} catch (error) {
  if (error instanceof WorkflowRunInProgressError) {
    // the first run is still pending or running
  }
}
```

A run releases the slot when it pauses (`waitFor`, `pause`, `delay`, `waitUntil`, `poll`), completes, fails, or is cancelled. Resuming a paused run while another run holds the slot also throws `WorkflowRunInProgressError`.

`WorkflowClient` doesn't load workflow definitions, so it can't see `singleton` on the definition. Set it on the ref instead:

```typescript
const nightlySyncRef = workflow.ref('nightly-sync', { singleton: true })
await client.startWorkflow(nightlySyncRef, {})
```

## Resource ID

`resourceId` ties a run to an entity in your app, such as a user, tenant, or order.

- **Query.** `getRuns({ resourceId })` lists the runs for that entity.
- **Scope.** When you pass `resourceId` to `getRun`, `pauseWorkflow`, `resumeWorkflow`, `cancelWorkflow`, `triggerEvent`, and the other run methods, the query also matches on `resource_id`. A run that belongs to a different resource returns `WorkflowRunNotFoundError`. Use this for tenant isolation.

```typescript
const run = await engine.startWorkflow({
  workflowId: 'send-invoice',
  resourceId: 'tenant_42',
  input: { orderId: 'ord_1', total: 99 },
})

const { items } = await engine.getRuns({ resourceId: 'tenant_42' })
```

`resourceId` is optional everywhere. Omit it to address runs by `runId` alone.

## Idempotency key

Pass `idempotencyKey` when the same start can be requested twice, for example on a double click, a client retry, or an at-least-once webhook. A second `startWorkflow` with the same key returns the existing run and enqueues nothing.

```typescript
const first = await engine.startWorkflow({
  workflowId: 'send-invoice',
  input: { orderId: 'ord_1', total: 99 },
  idempotencyKey: 'send-invoice:ord_1',
})

const second = await engine.startWorkflow({
  workflowId: 'send-invoice',
  input: { orderId: 'ord_1', total: 99 },
  idempotencyKey: 'send-invoice:ord_1',
})

second.id === first.id // true
```

Keys are unique across the whole table, not per workflow or resource, and can be up to 256 characters. Prefix them with the workflow ID. The input of a duplicate call is ignored.

## Input validation

`inputSchema` accepts any [Standard Schema](https://github.com/standard-schema/standard-schema) validator, including Zod, Valibot, and ArkType. `startWorkflow` validates the input before creating the run, and the handler's `input` is typed from the schema.

**Zod:**

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'

const onboarding = workflow(
  'user-onboarding',
  async ({ step, input }) => {
    // input: { email: string; name: string }
    await step.run('greet', async () => `Welcome, ${input.name}`)
  },
  { inputSchema: z.object({ email: z.email(), name: z.string() }) },
)
```

**Valibot:**

```typescript
import { workflow } from 'pg-workflows'
import * as v from 'valibot'

const onboarding = workflow(
  'user-onboarding',
  async ({ step, input }) => {
    // input: { email: string; name: string }
    await step.run('greet', async () => `Welcome, ${input.name}`)
  },
  { inputSchema: v.object({ email: v.pipe(v.string(), v.email()), name: v.string() }) },
)
```

**No schema.** `input` is `unknown` and isn't validated, so narrow it yourself:

```typescript
const refund = workflow('refund', async ({ step, input }) => {
  const { orderId } = input as { orderId: string }
  await step.run('refund-order', async () => ({ refunded: orderId }))
})
```
