# @pg-workflows/otel

OpenTelemetry tracing for [pg-workflows](https://github.com/SokratisVidros/pg-workflows). `otelPlugin` emits one span per workflow execution and one per step. It's a separate package so the engine has no OpenTelemetry dependency.

## Quickstart

This prints spans to the console. It assumes a Postgres at `DATABASE_URL`. The [engine quickstart](https://github.com/SokratisVidros/pg-workflows#quickstart) has a Docker command for one.

```bash
npm install pg-workflows pg @pg-workflows/otel @opentelemetry/api @opentelemetry/sdk-node
npm install -D tsx
```

Save as `traced.ts`:

```typescript
import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { otelPlugin } from '@pg-workflows/otel'
import { WorkflowEngine, WorkflowStatus, workflow } from 'pg-workflows'

const sdk = new NodeSDK({ traceExporter: new tracing.ConsoleSpanExporter() })
sdk.start()

const tracedWorkflow = workflow.use(otelPlugin())

const checkout = tracedWorkflow('checkout', async ({ step }) => {
  const charge = await step.run('charge', async () => ({ chargeId: 'ch_123' }))
  await step.run('send-receipt', async () => ({ sentFor: charge.chargeId }))
  return charge
})

async function main() {
  const engine = new WorkflowEngine({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
    workflows: [checkout],
  })
  await engine.start()

  const run = await engine.startWorkflow({ workflowId: 'checkout', input: {} })

  let result = await engine.getRun({ runId: run.id })
  while (result.status === WorkflowStatus.PENDING || result.status === WorkflowStatus.RUNNING) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    result = await engine.getRun({ runId: run.id })
  }

  await engine.stop()
  await sdk.shutdown()
}

main()
```

```bash
npx tsx traced.ts
```

The output includes a `pg_workflows.workflow.run` span and two `pg_workflows.step.run` spans. In production, replace `ConsoleSpanExporter` with your exporter, for example `OTLPTraceExporter` from `@opentelemetry/exporter-trace-otlp-http`.

## Spans

```
pg_workflows.workflow.run
├── pg_workflows.step.run
├── pg_workflows.step.waitFor
├── pg_workflows.step.delay
├── pg_workflows.step.waitUntil
├── pg_workflows.step.pause
├── pg_workflows.step.poll
└── pg_workflows.step.invokeChildWorkflow
```

`step.sleep` is an alias for `step.delay` and emits `pg_workflows.step.delay`.

**One trace per execution.** A run that pauses (`waitFor`, `delay`, `pause`, and so on) and later resumes produces a new trace for each execution. Correlate them with the `workflow.id` and `workflow.run_id` attributes.

**Step spans are recorded when the step finishes.** Each step span gets its start time from when the step began, but the span object is created only after the step returns or throws. Spans your code creates inside a `step.run` callback, including auto-instrumented HTTP or database calls, are therefore children of `pg_workflows.workflow.run`, not of the step span.

## Attributes

| Span | Attributes |
|------|------------|
| `pg_workflows.workflow.run` | `workflow.id`, `workflow.run_id`, `workflow.attempt` (same as `run.retryCount`), `workflow.resource_id` (when set), and anything returned by the `attributes` option |
| `pg_workflows.step.<kind>` | `step.id`, `step.type` (a `StepType` value) |

On success, a span's status is `OK`. On error, the plugin calls `recordException(error)` and sets the status to `ERROR` with the error message.

## Replayed steps

When a run resumes, the handler runs from the top, and completed steps return their saved output. The plugin emits no span for these replays. It uses `isStepCached(context.timeline, stepId)` from `pg-workflows`. A step counts as cached when:

- its output is in the timeline, or
- it's a `step.invokeChildWorkflow` whose child run has already been created. This covers a parent that re-enters the step while the child is still running.

Two exceptions:

- **`step.poll`** emits a span on every check, because each check is a real attempt.
- **`step.run` returning `undefined`** emits no span. Return a value (for example `{ sent: true }`) from steps you want traced.

## Options

```typescript
import { trace } from '@opentelemetry/api'
import { otelPlugin } from '@pg-workflows/otel'

otelPlugin({
  tracer: trace.getTracer('billing-worker'),
  spanNamePrefix: 'billing',
  attributes: (ctx) => ({ 'tenant.id': ctx.resourceId ?? 'none' }),
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tracer` | `Tracer` | `trace.getTracer('pg-workflows')` | The tracer that creates spans. |
| `spanNamePrefix` | `string` | `'pg_workflows'` | Replaces `pg_workflows` in every span name. |
| `attributes` | `(ctx: WorkflowContext) => Record<string, AttributeValue>` | none | Extra attributes for the `workflow.run` span. Receives the handler context, including `input` and `resourceId`. |

## Errors

When a step or handler throws, the plugin records the exception, sets the span status to `ERROR`, and rethrows the original error. Retries and failure handling in the engine are unchanged.

A thrown non-`Error` value (`throw 'msg'`) is wrapped in an `Error` for the span only. The original value is rethrown.

## Composing plugins

`otelPlugin` uses the `wrap(context, next)` middleware hook that any plugin can implement. With several plugins, the first one passed to `.use()` is the outermost wrap:

```typescript
import { otelPlugin } from '@pg-workflows/otel'
import { type WorkflowPlugin, workflow } from 'pg-workflows'

const timingPlugin: WorkflowPlugin = {
  name: 'timing',
  methods: () => ({}),
  wrap: async (ctx, next) => {
    const startedAt = Date.now()
    try {
      return await next()
    } finally {
      ctx.logger.log(`${ctx.workflowId} execution took ${Date.now() - startedAt}ms`)
    }
  },
}

// timingPlugin wraps the whole execution, including the workflow.run span
const instrumentedWorkflow = workflow.use(timingPlugin).use(otelPlugin())
```

## Context propagation

Nested spans need a context manager that follows `await`. `NodeSDK` from `@opentelemetry/sdk-node` registers one. If you set up OpenTelemetry by hand, install `@opentelemetry/context-async-hooks` and register it:

```typescript
import { context } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'

context.setGlobalContextManager(new AsyncHooksContextManager().enable())
```

## Not supported yet

Most of these need the trace context stored with the run, and are expected to ship together.

- **Metrics.** Only traces are emitted.
- **Linking executions.** A resumed run starts a new root trace, not a continuation of the previous one.
- **Child workflow traces.** A child run starts its own root trace.
- **Caller context.** The trace of the request that called `startWorkflow` isn't propagated into the run.
- **Dead-letter failures.** When retries run out, the run is marked failed outside the plugin chain, so that final transition has no span. The error is already on the last execution's span.
- **Sampling.** The plugin uses your `TracerProvider`'s sampler.

## Migrating from pg-workflows 0.15 and earlier

`otelPlugin` used to be exported from `pg-workflows`. Install `@pg-workflows/otel` and change the import. Options and spans are unchanged.

```diff
-import { workflow, otelPlugin } from 'pg-workflows'
+import { otelPlugin } from '@pg-workflows/otel'
+import { workflow } from 'pg-workflows'
```

## Requirements

- `pg-workflows` >= 0.16.0 (peer dependency)
- `@opentelemetry/api` ^1.9.0 (peer dependency)
- An OpenTelemetry SDK with an async context manager. See [Context propagation](#context-propagation).
