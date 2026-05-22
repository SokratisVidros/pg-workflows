# Observability with OpenTelemetry

pg-workflows ships a first-party `otelPlugin` that emits OpenTelemetry spans for workflow and step execution. `@opentelemetry/api` is an **optional peer dependency** — users who don't import the plugin pay zero runtime cost.

## Quick start

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { workflow, otelPlugin } from 'pg-workflows';

// Initialize your OTel SDK however you normally do. NodeSDK registers an
// AsyncHooks context manager, which is required for hierarchical (parent/child)
// spans across `await` boundaries inside workflow handlers.
new NodeSDK({ /* exporters, resource, ... */ }).start();

const tracedWorkflow = workflow.use(otelPlugin());

const checkout = tracedWorkflow('checkout', async ({ step }) => {
  await step.run('charge', async () => { /* ... */ });
  await step.waitFor('await-shipment', { eventName: 'shipped' });
});
```

## Span hierarchy

Each worker execution of a workflow run produces one trace. A workflow that pauses (`step.waitFor`, `step.delay`, etc.) and resumes later produces a **new trace per resume cycle**. Traces are stitched together via the shared `workflow.id` and `workflow.run_id` attributes.

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

`step.sleep` is an alias for `step.delay`; calls to it emit a `pg_workflows.step.delay` span (semantic consistency — both represent a sleep).

## Attributes

| Span                                 | Attributes                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_workflows.workflow.run`          | `workflow.id`, `workflow.run_id`, `workflow.attempt` (= `run.retryCount`), `workflow.resource_id` (when set), plus any user-supplied attrs |
| `pg_workflows.step.<kind>`           | `step.id`, `step.type` (matches the `StepType` enum value)                                                                                |
| Any span on error                    | `recordException(err)`, `status.code = ERROR`, `status.message = err.message`                                                             |
| Any span on success                  | `status.code = OK`                                                                                                                        |

## Cache-hit suppression

When a workflow resumes after a pause, the handler re-runs from the top. Steps that completed in a prior execution return their cached output instantly. The plugin detects these cache-hit replays and **does not emit a span** for them.

Detection is based on `context.timeline`:

- A step has an output cached in the timeline (`timeline[stepId].output !== undefined`) → cache hit.
- `step.invokeChildWorkflow` additionally checks for the in-flight binding key (`__invokeChildWorkflow:<stepId>`) — a parent run that re-enters this step during a resume-while-child-still-running cycle is also treated as a cache hit.

Exception: `step.poll` does not use the cache-hit guard. Each handler invocation that reaches `step.poll` represents a meaningful poll attempt worth tracing.

## Plugin composition

The OTel plugin uses the same `wrap(context, next)` middleware hook that any plugin can implement. If you register multiple plugins via `workflow.use(...)`, their wraps compose in registration order — the first plugin's wrap is outermost.

```ts
const w = workflow
  .use(loggingPlugin)              // outermost wrap
  .use(otelPlugin())               // inner wrap (workflow.run span opens inside loggingPlugin)
  ('checkout', async ({ step }) => { /* ... */ });
```

## Options

```ts
otelPlugin({
  // Tracer to use. Defaults to `trace.getTracer('pg-workflows')`.
  tracer: trace.getTracer('my-app'),

  // Span name prefix. Defaults to 'pg_workflows'.
  spanNamePrefix: 'pg_workflows',

  // Optional callback returning extra attributes for the workflow.run span.
  // Receives the WorkflowContext so you can extract values from the input
  // or the run's resourceId.
  attributes: (ctx) => ({ tenant: ctx.resourceId }),
});
```

## Error semantics

When a step or workflow handler throws:

1. The span's exception is recorded via `span.recordException(error)`.
2. The span status is set to `ERROR` with the error's message.
3. The **original error** is re-thrown — engine retry/DLQ behaviour is unaffected.

Non-`Error` throws (e.g., `throw 'msg'`) are coerced to an `Error` for the OTel API only; the original value is preserved on the re-throw path.

## Not in v1

These are deliberately out of scope for the initial release. They share a common requirement (durable storage of trace context) and will likely land together when the underlying schema work is done.

- **Metrics** (counters, histograms, gauges) — different OTel API surface; layers onto the same plugin hooks.
- **Cross-execution trace context propagation** — paused workflows resume as a fresh root trace today. Linking the resume to the prior execution requires persisting the `traceparent` header.
- **`step.invokeChildWorkflow` parent-trace continuation** — child runs start a fresh root trace. Same persistence question.
- **Caller context propagation into `engine.startWorkflow`** — an incoming HTTP trace does not currently propagate into the workflow run.
- **DLQ span emission** — `handleWorkflowRunDlq` runs outside the workflow's plugin chain. DLQ-induced FAILED states therefore don't produce a `workflow.run` span. The precipitating error is already recorded on the last per-execution span via the catch path.
- **Sampling controls** — the plugin defers to your configured `TracerProvider` for sampling.

## Requirements

- `@opentelemetry/api` ^1.9.0 (optional peer)
- An OTel SDK that registers an AsyncHooks context manager. `@opentelemetry/sdk-node`'s `NodeSDK` does this automatically. If you're wiring OTel manually, install `@opentelemetry/context-async-hooks` and call `context.setGlobalContextManager(new AsyncHooksContextManager().enable())`.
