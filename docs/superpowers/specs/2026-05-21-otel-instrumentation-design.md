# OpenTelemetry Instrumentation — Design

- **Issue:** [#34](https://github.com/SokratisVidros/pg-workflows/issues/34)
- **Status:** Approved for implementation
- **Date:** 2026-05-21

## Goal

Allow pg-workflows users to emit OpenTelemetry traces for workflow and step execution, with zero runtime cost when unused.

## Scope (v1)

**In scope:**

- A first-party plugin, `otelPlugin`, shipped from the `pg-workflows` package.
- A `workflow.run` span per worker execution of a workflow run, with child spans for each step kind (`step.run`, `step.wait_for`, `step.delay`, `step.wait_until`, `step.pause`, `step.poll`, `step.invoke_child_workflow`).
- Hierarchical traces via OpenTelemetry's AsyncLocalStorage active context (no manual context plumbing in user workflows).
- Suppression of spans for cache-hit step replays.
- Optional peer dependency on `@opentelemetry/api`. Non-users pay zero cost.

**Out of scope for v1** (see [Out of scope](#out-of-scope-for-v1) below for rationale and deferral notes).

## Decisions

| Decision                          | Choice                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution                      | First-party plugin in `pg-workflows`. Optional peer dep on `@opentelemetry/api`.                                                      |
| Scope                             | Step spans + a parent `workflow.run` span (hierarchical traces). Metrics deferred.                                                    |
| Span lifetime                     | One span per worker execution of the run. A long-paused workflow produces multiple traces, stitched via `workflow.id` / `workflow.run_id` attributes. |
| Plugin hook shape                 | A new optional `wrap(context, next)` hook on `WorkflowPlugin`. Composes as middleware. Better fit for `tracer.startActiveSpan` than a before/after pair. |
| Cache-hit replay handling         | Skip spans for cache-hit step calls. Detected via `context.timeline[stepId]?.output !== undefined` (plus the invoke-child binding key for that step kind). |

## Architecture

### Plugin interface extension (`src/types.ts`)

```ts
export interface WorkflowPlugin<TStepBase = StepBaseContext, TStepExt = object> {
  name: string;
  methods: (step: TStepBase, context: WorkflowContext) => TStepExt;
  wrap?: (context: WorkflowContext, next: () => Promise<unknown>) => Promise<unknown>;
}
```

`methods` gains a `context` argument so plugins can inspect the timeline for cache-hit detection. The change is additive — existing plugins that ignore the new arg compile unchanged.

`wrap` is optional. When present, the engine inserts it into a middleware chain around the workflow handler invocation.

### Engine wiring (`src/engine.ts`)

Inside `handleWorkflowRun`, after composing `step` via `plugin.methods(step, context)`, the handler call site changes from:

```ts
const result = await workflow.handler(context);
```

to:

```ts
let next: () => Promise<unknown> = () => workflow.handler(context);
for (const plugin of [...plugins].reverse()) {
  if (plugin.wrap) {
    const inner = next;
    next = () => plugin.wrap!(context, inner);
  }
}
const result = await next();
```

Order rules: the first plugin passed to `.use()` is the outermost wrap. Multiple plugins compose as standard middleware.

### OTel plugin (`src/plugins/otel.ts`)

Exported from the package's main entry as `otelPlugin`.

**Public API:**

```ts
import { otelPlugin } from 'pg-workflows';
import { trace } from '@opentelemetry/api';

const tracedWorkflow = workflow.use(otelPlugin({
  tracer: trace.getTracer('my-app'),         // optional; default: trace.getTracer('pg-workflows', VERSION)
  spanNamePrefix: 'pg_workflows',            // optional; default shown
  attributes: (ctx) => ({ tenant: ctx.input.tenantId }), // optional; merged onto workflow.run span
}));
```

**Behaviour:**

- `wrap` opens a `${spanNamePrefix}.workflow.run` active span around `next()`. On thrown error: `span.recordException(err)`, `setStatus({ code: ERROR })`, re-throw. On clean return: `setStatus({ code: OK })`. Span ends in `finally`.
- `methods` returns a step API where every method is wrapped to open `${spanNamePrefix}.step.<kind>` spans, but only when the corresponding timeline slot is empty.
- All spans share parent context via `tracer.startActiveSpan`. AsyncLocalStorage handles propagation through `await` boundaries automatically.

### Span hierarchy and attributes

```
pg_workflows.workflow.run
├── pg_workflows.step.run
├── pg_workflows.step.wait_for
├── pg_workflows.step.delay
├── pg_workflows.step.wait_until
├── pg_workflows.step.pause
├── pg_workflows.step.poll
└── pg_workflows.step.invoke_child_workflow
```

| Span                                 | Attributes                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `workflow.run`                       | `workflow.id`, `workflow.run_id`, `workflow.resource_id` (if present), `workflow.attempt` (= `run.retryCount`), plus anything from the user's `attributes(ctx)` callback |
| `step.<kind>` (all kinds)            | `step.id`, `step.type` (matches the `StepType` enum value)                                          |
| `step.invoke_child_workflow`         | Plus `child.workflow_id`, `child.run_id` once the child run has been created                        |
| Any span on error                    | `recordException(err)`, `setStatus({ code: ERROR, message })`                                       |

### Cache-hit suppression

Before opening a span, each wrapped step method checks:

```ts
function isCachedHit(ctx: WorkflowContext, stepId: string, kind: StepType): boolean {
  const entry = ctx.timeline[stepId];
  if (entry && typeof entry === 'object' && 'output' in entry && (entry as any).output !== undefined) {
    return true;
  }
  if (kind === StepType.INVOKE_CHILD_WORKFLOW) {
    const binding = ctx.timeline[`__invokeChildWorkflow:${stepId}`];
    if (binding) return true; // in-flight resume; will produce no new work this execution
  }
  return false;
}
```

When cached, the wrapper passes through to the base step method without opening a span. The timeline snapshot is taken at handler entry, so steps completed during the *current* execution are still spanned correctly.

### Packaging

In `package.json`:

```json
"peerDependencies": {
  "pg": "^8.0.0",
  "@opentelemetry/api": "^1.9.0"
},
"peerDependenciesMeta": {
  "@opentelemetry/api": { "optional": true }
}
```

The OTel plugin file imports `@opentelemetry/api` directly. Users who never import `otelPlugin` never load this module, so the optional peer never resolves.

Devs add `@opentelemetry/sdk-trace-base` to `devDependencies` for tests.

## Testing

Lives in `src/plugins/otel.test.ts`, runs in the existing unit suite (PGlite-backed).

Test setup registers a `BasicTracerProvider` with an `InMemorySpanExporter` once per test, asserts against `exporter.getFinishedSpans()`.

Cases:

1. **Single-step happy path** — one `step.run` produces exactly 2 spans: `workflow.run` parent + `step.run` child. Attributes match. Both `OK`.
2. **Multi-step with pause** — workflow runs `step1.run` → `step2.waitFor`. First execution emits `workflow.run` + `step1.run` + `step2.wait_for`. `triggerEvent` resumes; second execution emits a new `workflow.run` trace containing only the post-pause work (cached `step1` and the resumed `step2` emit no spans).
3. **Step throws** — `step.run`'s handler throws. The `step.run` span has `ERROR` status with a recorded exception. The error propagates so `run.error` is persisted and pg-boss retry semantics are unchanged.
4. **`invokeChildWorkflow` cache replay** — parent's `step.invoke_child_workflow` span is emitted on the pause execution. On the resume execution, the binding key is present and the cached output completes, so no span is emitted.
5. **Plugin composition order** — register a trivial second wrap plugin alongside `otelPlugin` (in both orders) and assert wraps compose in `.use()` registration order.
6. **Cache-hit predicate unit test** — direct test of the `isCachedHit` predicate against the timeline shapes produced by each step kind.

## Documentation

- New "Observability with OpenTelemetry" section in `README.md` with a ~10-line quickstart: register provider → `.use(otelPlugin())` → done.
- JSDoc on `otelPlugin` listing all options and defaults.
- Bullet under "Core API" in `AGENTS.md` pointing to the plugin.

## Out of scope for v1

These items appear in the original issue but are deferred. Documented here so they aren't lost.

### Metrics

The issue proposes `pg_workflows.workflow.started`, `pg_workflows.workflow.completed`, `pg_workflows.step.duration`, `pg_workflows.queue.depth`. These use OTel's metrics API (`@opentelemetry/api/metrics`), a separate surface from traces. They can layer onto the same plugin hooks added in v1, so the v1 plugin interface remains forward-compatible.

`queue.depth` is harder than the rest — pg-boss does not expose a synchronous queue-size primitive; implementing it requires either polling `pgboss.job` or a counter maintained at enqueue/dequeue time. Defer until there is concrete demand.

### Cross-execution trace context propagation

When a workflow pauses and resumes, the resume execution gets a fresh root span — there is no link to the previous execution's trace beyond shared `workflow.run_id` attributes. Linking them would require persisting the trace context (`traceparent` header value) somewhere durable, e.g. in `workflow_runs.timeline` or a dedicated column.

Same for `step.invoke_child_workflow`: child runs currently start a fresh root span rather than continuing the parent's trace.

Both deferred together because they share the persistence design question.

### `engine.startWorkflow` caller context propagation

When an HTTP request invokes `engine.startWorkflow`, the request's incoming trace context is not propagated into the workflow run. Same persistence question as above; deferred together.

### DLQ span emission

`handleWorkflowRunDlq` runs outside the workflow's plugin chain (no handler invocation, no `context` object). DLQ-induced FAILED states therefore produce no `workflow.run` span. This is acceptable for v1 because the precipitating error is already recorded on the last per-execution `workflow.run` span via the catch path. Revisit if users report missing visibility on final-failure reconciliation.

### Sampling, head-based vs tail-based decisions

The plugin defers to the user's configured `TracerProvider` for sampling. No plugin-level sampling controls in v1.
