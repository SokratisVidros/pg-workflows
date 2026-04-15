# Examples

Common patterns you can build with pg-workflows. See the [`examples/`](https://github.com/SokratisVidros/pg-workflows/tree/main/examples) directory in the repo for runnable code.

## Conditional Steps

```typescript
const conditionalWorkflow = workflow('conditional', async ({ step }) => {
  const data = await step.run('fetch-data', async () => {
    return { isPremium: true }
  })

  await step.run('premium-action', async () => {
    if (data.isPremium) {
      // Only runs for premium users
    }
  })
})
```

## Batch Processing with Loops

```typescript
const batchWorkflow = workflow('batch-process', async ({ step }) => {
  const items = await step.run('get-items', async () => {
    return [1, 2, 3, 4, 5]
  })

  for (const item of items) {
    await step.run(`process-${item}`, async () => {
      // Each item is processed durably
      return processItem(item)
    })
  }
})
```

## Scheduled Reminder with Delay

```typescript
const reminderWorkflow = workflow(
  'send-reminder',
  async ({ step, input }) => {
    await step.run('send-initial', async () => {
      return await sendEmail(input.email, 'Welcome!')
    })
    // Pause for 3 days, then send follow-up (durable — survives restarts)
    await step.delay('cool-off', '3 days')
    await step.run('send-follow-up', async () => {
      return await sendEmail(input.email, 'Here’s a reminder…')
    })
  },
  { inputSchema: z.object({ email: z.string().email() }) },
)
```

## Polling Until a Condition Is Met

```typescript
const paymentWorkflow = workflow('await-payment', async ({ step, input }) => {
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
})
```

## Error Handling with Retries

```typescript
const resilientWorkflow = workflow(
  'resilient',
  async ({ step }) => {
    await step.run('risky-operation', async () => {
      // Retries up to 3 times with exponential backoff
      return await riskyApiCall()
    })
  },
  {
    retries: 3,
    timeout: 60000,
  },
)
```

## Monitoring Workflow Progress

```typescript
const progress = await engine.checkProgress({
  runId: run.id,
  resourceId: 'resource-123',
})

console.log({
  status: progress.status,
  completionPercentage: progress.completionPercentage,
  completedSteps: progress.completedSteps,
  totalSteps: progress.totalSteps,
})
```
