# OpenTelemetry Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-party `otelPlugin` that emits OpenTelemetry spans for workflow and step execution, with zero cost when not used.

**Architecture:** Add an optional `wrap(context, next)` hook to `WorkflowPlugin` and pass `context` into `methods(step, context)`. The engine composes plugin wraps as middleware around the workflow handler. The OTel plugin opens one `workflow.run` span per execution via `wrap` and wraps every step method to open a child span, suppressing spans for cache-hit replays by inspecting `context.timeline`.

**Tech Stack:** TypeScript ESM/CJS, Vitest (unit suite uses PGlite), Biome (no semicolons, single quotes), `@opentelemetry/api` (optional peer), `@opentelemetry/sdk-trace-base` + `@opentelemetry/context-async-hooks` (devDeps for tests).

**Spec:** `docs/superpowers/specs/2026-05-21-otel-instrumentation-design.md`

---

## File Map

- **Create:** `src/plugins/otel.ts` — the plugin (~120 LOC).
- **Create:** `src/plugins/otel.test.ts` — full test coverage (~300 LOC).
- **Create:** `src/plugins/otel-test-helpers.ts` — tracer/exporter bootstrap shared by tests.
- **Modify:** `src/types.ts` — extend `WorkflowPlugin` with `wrap?` and add `context` param to `methods`.
- **Modify:** `src/engine.ts` — pass `context` to `plugin.methods`, compose `plugin.wrap` chain around handler call.
- **Modify:** `src/index.ts` — export `otelPlugin`.
- **Modify:** `package.json` — `@opentelemetry/api` optional peer dep, plus devDeps for testing.
- **Modify:** `README.md` — add Observability section.
- **Modify:** `AGENTS.md` — bullet under Core API.

---

## Task 1: Add OpenTelemetry dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `@opentelemetry/api` as optional peer dep and add devDeps**

Edit `package.json`. Add to `peerDependencies`:

```json
"peerDependencies": {
  "pg": "^8.0.0",
  "@opentelemetry/api": "^1.9.0"
}
```

Add new top-level `peerDependenciesMeta`:

```json
"peerDependenciesMeta": {
  "@opentelemetry/api": { "optional": true }
}
```

Add to `devDependencies` (keep alphabetical order):

```json
"@opentelemetry/api": "^1.9.0",
"@opentelemetry/context-async-hooks": "^1.27.0",
"@opentelemetry/sdk-trace-base": "^1.27.0"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates; no errors.

- [ ] **Step 3: Verify the rest of the build still works**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add OpenTelemetry deps for otelPlugin"
```

---

## Task 2: Extend `WorkflowPlugin` interface in types.ts

**Files:**
- Modify: `src/types.ts:90-96`

- [ ] **Step 1: Update `WorkflowPlugin` interface**

In `src/types.ts`, replace the `WorkflowPlugin` interface:

```ts
/**
 * Plugin that extends the workflow step API with extra methods.
 * @template TStepBase - The step type this plugin receives (base + previous plugins).
 * @template TStepExt - The extra methods this plugin adds to step.
 */
export interface WorkflowPlugin<TStepBase = StepBaseContext, TStepExt = object> {
  name: string
  methods: (step: TStepBase, context: WorkflowContext) => TStepExt
  /**
   * Optional middleware around the workflow handler call. Composes in
   * registration order — the first plugin passed to `.use()` wraps everything
   * inside. Implementations MUST call `next()` exactly once.
   */
  wrap?: (context: WorkflowContext, next: () => Promise<unknown>) => Promise<unknown>
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: existing plugin tests in `src/engine.test.ts` still compile (their `methods: (step) => ({...})` is assignable to `(step, context) => ({...})` because TS allows passing fewer params).

- [ ] **Step 3: Run unit suite**

Run: `npm run test:unit`
Expected: all existing tests pass; no behavioural change yet.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add wrap hook and context arg to WorkflowPlugin"
```

---

## Task 3: Wire engine to pass context and compose wrap chain

**Files:**
- Modify: `src/engine.ts:1124-1140`
- Modify: `src/engine.test.ts` (add wrap composition test)

- [ ] **Step 1: Write the failing test for wrap composition**

Append to `src/engine.test.ts` inside the `describe('workflow.use(plugin)', () => { ... })` block:

```ts
it('should call plugin.wrap around the handler and compose multiple wraps in registration order', async () => {
  const calls: string[] = []

  const outerPlugin: WorkflowPlugin<StepBaseContext, object> = {
    name: 'outer',
    methods: () => ({}),
    wrap: async (_ctx, next) => {
      calls.push('outer:before')
      const result = await next()
      calls.push('outer:after')
      return result
    },
  }

  const innerPlugin: WorkflowPlugin<StepBaseContext, object> = {
    name: 'inner',
    methods: () => ({}),
    wrap: async (_ctx, next) => {
      calls.push('inner:before')
      const result = await next()
      calls.push('inner:after')
      return result
    },
  }

  const engine = new WorkflowEngine({ workflows: [], pool: testPool, boss: testBoss })
  await engine.start()

  const wrapped = workflow
    .use(outerPlugin)
    .use(innerPlugin)('wrap-order-workflow', async ({ step }) => {
      calls.push('handler')
      await step.run('only-step', async () => 'ok')
      return 'done'
    })

  await engine.registerWorkflow(wrapped)
  const run = await engine.startWorkflow({ workflowId: 'wrap-order-workflow', input: {} })

  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  expect(calls).toEqual([
    'outer:before',
    'inner:before',
    'handler',
    'inner:after',
    'outer:after',
  ])

  await engine.stop()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- engine.test.ts -t "compose multiple wraps"`
Expected: FAIL (wrap is not invoked yet).

- [ ] **Step 3: Modify `handleWorkflowRun` to pass context and compose wraps**

In `src/engine.ts`, locate the block that currently reads (around lines 1124–1140):

```ts
      let step = { ...baseStep };
      const plugins = workflow.plugins ?? [];
      for (const plugin of plugins) {
        const extra = plugin.methods(step);
        step = { ...step, ...extra };
      }

      const context: WorkflowContext = {
        input: run.input as InferInputParameters<InputParameters>,
        workflowId: run.workflowId,
        runId: run.id,
        timeline: run.timeline,
        logger: this.logger,
        step,
      };

      const result = await workflow.handler(context);
```

Replace it with:

```ts
      const plugins = workflow.plugins ?? [];

      const context: WorkflowContext = {
        input: run.input as InferInputParameters<InputParameters>,
        workflowId: run.workflowId,
        runId: run.id,
        timeline: run.timeline,
        logger: this.logger,
        // step is populated below once plugins.methods has run
        step: baseStep as WorkflowContext['step'],
      };

      let step = { ...baseStep };
      for (const plugin of plugins) {
        const extra = plugin.methods(step, context);
        step = { ...step, ...extra };
      }
      context.step = step as WorkflowContext['step'];

      let next: () => Promise<unknown> = () => workflow.handler(context);
      for (const plugin of [...plugins].reverse()) {
        if (plugin.wrap) {
          const inner = next;
          const wrap = plugin.wrap;
          next = () => wrap(context, inner);
        }
      }

      const result = await next();
```

Rationale:
- `context` is constructed before `plugin.methods` runs so methods can read `context.timeline` for cache-hit detection.
- `context.step` is assigned the composed step API afterward (the same object the handler sees).
- The wrap chain is built bottom-up: the last plugin's wrap is innermost, the first plugin's wrap is outermost. Plugins without `wrap` are skipped.

- [ ] **Step 4: Run the failing test to verify it now passes**

Run: `npm run test:unit -- engine.test.ts -t "compose multiple wraps"`
Expected: PASS, with `calls` in the exact order asserted.

- [ ] **Step 5: Run the full unit suite to confirm no regressions**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): compose plugin.wrap middleware and pass context to methods"
```

---

## Task 4: Create OTel test helpers

**Files:**
- Create: `src/plugins/otel-test-helpers.ts`

- [ ] **Step 1: Create the helper module**

Create `src/plugins/otel-test-helpers.ts`:

```ts
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { context, type Tracer, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

/**
 * Build a fresh tracer + in-memory exporter for a single test.
 * Callers MUST invoke `teardown()` in `afterEach`.
 */
export function setupOtel(): {
  tracer: Tracer
  getSpans: () => ReadableSpan[]
  getSpansByName: (name: string) => ReadableSpan[]
  teardown: () => Promise<void>
} {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  // AsyncHooks context manager is required for nested step spans to attach
  // to the workflow.run span across `await` boundaries. We register it
  // globally because OTel's context API reads from the global manager.
  const contextManager = new AsyncHooksContextManager().enable()
  context.setGlobalContextManager(contextManager)

  const tracer = provider.getTracer('pg-workflows-test')

  return {
    tracer,
    getSpans: () => exporter.getFinishedSpans(),
    getSpansByName: (name: string) =>
      exporter.getFinishedSpans().filter((s) => s.name === name),
    teardown: async () => {
      await provider.shutdown()
      contextManager.disable()
      context.disable()
      trace.disable()
    },
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/otel-test-helpers.ts
git commit -m "test: add OTel test bootstrap helper"
```

---

## Task 5: Create plugin skeleton

**Files:**
- Create: `src/plugins/otel.ts`
- Create: `src/plugins/otel.test.ts`

- [ ] **Step 1: Write the failing test — plugin registers and a workflow completes**

Create `src/plugins/otel.test.ts`:

```ts
import type pg from 'pg'
import type { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { workflow } from '../definition'
import { WorkflowEngine } from '../engine'
import { getBoss } from '../tests/pgboss'
import { closeTestDatabase, createTestDatabase } from '../tests/test-db'
import { WorkflowStatus } from '../types'
import { otelPlugin } from './otel'
import { setupOtel } from './otel-test-helpers'

let testBoss: PgBoss
let testPool: pg.Pool

beforeAll(async () => {
  testPool = await createTestDatabase()
  testBoss = await getBoss(testPool)
})

afterAll(async () => {
  await closeTestDatabase()
})

describe('otelPlugin', () => {
  let otel: ReturnType<typeof setupOtel>
  let engine: WorkflowEngine

  beforeEach(async () => {
    otel = setupOtel()
    engine = new WorkflowEngine({ workflows: [], pool: testPool, boss: testBoss })
    await engine.start()
  })

  afterEach(async () => {
    await engine.stop()
    await otel.teardown()
  })

  it('registers and lets a workflow complete', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-smoke',
      async ({ step }) => {
        return await step.run('only', async () => 'ok')
      },
    )
    await engine.registerWorkflow(w)
    const run = await engine.startWorkflow({ workflowId: 'otel-smoke', input: {} })
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED, output: 'ok' })
  })
})
```

- [ ] **Step 2: Run test — should fail because `./otel` does not exist**

Run: `npm run test:unit -- otel.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Create skeleton plugin**

Create `src/plugins/otel.ts`:

```ts
import type { Tracer } from '@opentelemetry/api'
import type { StepBaseContext, WorkflowContext, WorkflowPlugin } from '../types'

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, string | number | boolean>
}

const DEFAULT_PREFIX = 'pg_workflows'

export function otelPlugin(
  _options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  return {
    name: 'opentelemetry',
    methods: () => ({}),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- otel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): plugin skeleton"
```

---

## Task 6: Expose `resourceId` and `attempt` on `WorkflowContext`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/engine.ts`

The `workflow.run` span (next task) needs `workflow.resource_id` and `workflow.attempt`. The current `WorkflowContext` doesn't expose them. Add the fields and populate from `run` in the engine. This is a pure-additive refactor — no new behaviour yet.

- [ ] **Step 1: Extend `WorkflowContext` type**

In `src/types.ts`, find the `WorkflowContext` type (around line 102) and add two new fields:

```ts
export type WorkflowContext<
  TInput extends InputParameters = InputParameters,
  TStep extends StepBaseContext = StepBaseContext,
> = {
  input: InferInputParameters<TInput>
  step: TStep
  workflowId: string
  runId: string
  /** Tenant/scope identifier set when the run was started, if any. */
  resourceId?: string
  /** Zero-based retry attempt number (= `run.retryCount`). */
  attempt: number
  timeline: Record<string, unknown>
  logger: WorkflowLogger
}
```

- [ ] **Step 2: Populate the new fields in the engine**

In `src/engine.ts`, in the `context` construction inside `handleWorkflowRun` (added in Task 3), change to:

```ts
      const context: WorkflowContext = {
        input: run.input as InferInputParameters<InputParameters>,
        workflowId: run.workflowId,
        runId: run.id,
        resourceId: run.resourceId ?? undefined,
        attempt: run.retryCount,
        timeline: run.timeline,
        logger: this.logger,
        step: baseStep as WorkflowContext['step'],
      };
```

- [ ] **Step 3: Run typecheck and unit suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: all pass; no behaviour change yet.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/engine.ts
git commit -m "feat(types): expose resourceId and attempt on WorkflowContext"
```

---

## Task 7: Implement `workflow.run` span (happy path)

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Add failing test for workflow.run span**

Append to the `describe('otelPlugin', ...)` block in `src/plugins/otel.test.ts`:

```ts
it('emits a workflow.run span on successful completion', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-wf-span',
    async () => 'done',
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({
    resourceId: 'tenant-1',
    workflowId: 'otel-wf-span',
    input: {},
  })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id, resourceId: 'tenant-1' }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  const spans = otel.getSpansByName('pg_workflows.workflow.run')
  expect(spans).toHaveLength(1)
  expect(spans[0].attributes).toMatchObject({
    'workflow.id': 'otel-wf-span',
    'workflow.run_id': run.id,
    'workflow.resource_id': 'tenant-1',
    'workflow.attempt': 0,
  })
  expect(spans[0].status.code).toBe(1) // SpanStatusCode.OK
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- otel.test.ts -t "workflow.run span on successful"`
Expected: FAIL — span list is empty (plugin still has no `wrap`).

- [ ] **Step 3: Implement `wrap` in the plugin**

Replace the contents of `src/plugins/otel.ts` with:

```ts
import {
  type AttributeValue,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api'
import type { StepBaseContext, WorkflowContext, WorkflowPlugin } from '../types'

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, AttributeValue>
}

const DEFAULT_PREFIX = 'pg_workflows'

export function otelPlugin(
  options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  const tracer = options.tracer ?? trace.getTracer('pg-workflows')
  const prefix = options.spanNamePrefix ?? DEFAULT_PREFIX
  const extraAttrs = options.attributes

  return {
    name: 'opentelemetry',

    methods: () => ({}),

    wrap: (context, next) =>
      tracer.startActiveSpan(
        `${prefix}.workflow.run`,
        {
          attributes: {
            'workflow.id': context.workflowId,
            'workflow.run_id': context.runId,
            'workflow.attempt': context.attempt,
            ...(context.resourceId ? { 'workflow.resource_id': context.resourceId } : {}),
            ...(extraAttrs ? extraAttrs(context) : {}),
          },
        },
        async (span) => {
          try {
            const result = await next()
            span.setStatus({ code: SpanStatusCode.OK })
            return result
          } finally {
            span.end()
          }
        },
      ),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- otel.test.ts -t "workflow.run span on successful"`
Expected: PASS.

- [ ] **Step 5: Run full unit suite — confirm no regressions**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): emit workflow.run span via wrap hook"
```

---

## Task 8: `workflow.run` span error path

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Write failing test**

Append to `describe('otelPlugin', ...)` in `src/plugins/otel.test.ts`:

```ts
it('records exception and ERROR status on workflow.run when handler throws', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-wf-throw',
    async ({ step }) => {
      await step.run('boom', async () => {
        throw new Error('kaboom')
      })
    },
    { retries: 0 },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-wf-throw', input: {} })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.FAILED })

  const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0]
  expect(wfSpan.status.code).toBe(2) // SpanStatusCode.ERROR
  expect(wfSpan.status.message).toBe('kaboom')
  expect(wfSpan.events.some((e) => e.name === 'exception')).toBe(true)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:unit -- otel.test.ts -t "ERROR status on workflow.run"`
Expected: FAIL — current `wrap` does not catch.

- [ ] **Step 3: Update `wrap` to record exceptions**

In `src/plugins/otel.ts`, replace the `wrap` arrow body:

```ts
    wrap: (context, next) =>
      tracer.startActiveSpan(
        `${prefix}.workflow.run`,
        {
          attributes: {
            'workflow.id': context.workflowId,
            'workflow.run_id': context.runId,
            'workflow.attempt': context.attempt,
            ...(context.resourceId ? { 'workflow.resource_id': context.resourceId } : {}),
            ...(extraAttrs ? extraAttrs(context) : {}),
          },
        },
        async (span) => {
          try {
            const result = await next()
            span.setStatus({ code: SpanStatusCode.OK })
            return result
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            span.recordException(error)
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
            throw err
          } finally {
            span.end()
          }
        },
      ),
```

- [ ] **Step 4: Run test — should pass**

Run: `npm run test:unit -- otel.test.ts -t "ERROR status on workflow.run"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): record exception on workflow.run span on failure"
```

---

## Task 9: `step.run` span with cache-hit suppression and error handling

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Write three failing tests**

Append to `src/plugins/otel.test.ts`:

```ts
it('emits step.run span as a child of workflow.run', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-step-run-child',
    async ({ step }) => {
      return await step.run('foo', async () => 'bar')
    },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-step-run-child', input: {} })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0]
  const stepSpan = otel.getSpansByName('pg_workflows.step.run')[0]
  expect(stepSpan).toBeDefined()
  expect(stepSpan.attributes).toMatchObject({ 'step.id': 'foo', 'step.type': 'run' })
  expect(stepSpan.parentSpanContext?.spanId).toBe(wfSpan.spanContext().spanId)
})

it('skips step.run span on cache-hit replay', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-cache-skip',
    async ({ step }) => {
      const a = await step.run('first', async () => 'A')
      await step.waitFor('gate', { eventName: 'go' })
      const b = await step.run('second', async () => 'B')
      return { a, b }
    },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-cache-skip', input: {} })

  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.PAUSED })

  // First execution: workflow.run + step.run('first') + step.waitFor('gate')
  expect(otel.getSpansByName('pg_workflows.step.run').map((s) => s.attributes['step.id'])).toEqual([
    'first',
  ])

  await engine.triggerEvent({ runId: run.id, eventName: 'go' })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  // Second execution: NEW workflow.run + step.run('second') only.
  // 'first' is a cache hit and emits no span.
  const stepRunSpans = otel.getSpansByName('pg_workflows.step.run')
  const ids = stepRunSpans.map((s) => s.attributes['step.id'])
  expect(ids).toEqual(['first', 'second'])
  expect(otel.getSpansByName('pg_workflows.workflow.run')).toHaveLength(2)
})

it('records exception and ERROR status on step.run when handler throws', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-step-throw',
    async ({ step }) => {
      await step.run('explode', async () => {
        throw new Error('nope')
      })
    },
    { retries: 0 },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-step-throw', input: {} })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.FAILED })

  const stepSpan = otel.getSpansByName('pg_workflows.step.run')[0]
  expect(stepSpan.status.code).toBe(2)
  expect(stepSpan.status.message).toBe('nope')
  expect(stepSpan.events.some((e) => e.name === 'exception')).toBe(true)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm run test:unit -- otel.test.ts -t "step.run"`
Expected: all three FAIL — `methods` is still `() => ({})`.

- [ ] **Step 3: Add a cache-hit predicate and step.run wrapper**

In `src/plugins/otel.ts`, replace the file with this complete version:

```ts
import {
  type AttributeValue,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api'
import type { StepBaseContext, WorkflowContext, WorkflowPlugin } from '../types'

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, AttributeValue>
}

const DEFAULT_PREFIX = 'pg_workflows'

function isCachedHit(timeline: Record<string, unknown>, stepId: string): boolean {
  const entry = timeline[stepId]
  if (
    entry &&
    typeof entry === 'object' &&
    'output' in entry &&
    (entry as { output: unknown }).output !== undefined
  ) {
    return true
  }
  return false
}

async function traceStep<T>(
  tracer: Tracer,
  name: string,
  attrs: Record<string, AttributeValue>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const result = await fn()
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      throw err
    } finally {
      span.end()
    }
  })
}

export function otelPlugin(
  options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  const tracer = options.tracer ?? trace.getTracer('pg-workflows')
  const prefix = options.spanNamePrefix ?? DEFAULT_PREFIX
  const extraAttrs = options.attributes

  return {
    name: 'opentelemetry',

    methods: (step, context) => ({
      run: async <T>(stepId: string, handler: () => Promise<T>) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.run(stepId, handler)
        }
        return traceStep(
          tracer,
          `${prefix}.step.run`,
          { 'step.id': stepId, 'step.type': 'run' },
          () => step.run(stepId, handler),
        )
      },
    }),

    wrap: (context, next) =>
      tracer.startActiveSpan(
        `${prefix}.workflow.run`,
        {
          attributes: {
            'workflow.id': context.workflowId,
            'workflow.run_id': context.runId,
            'workflow.attempt': context.attempt,
            ...(context.resourceId ? { 'workflow.resource_id': context.resourceId } : {}),
            ...(extraAttrs ? extraAttrs(context) : {}),
          },
        },
        async (span) => {
          try {
            const result = await next()
            span.setStatus({ code: SpanStatusCode.OK })
            return result
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            span.recordException(error)
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
            throw err
          } finally {
            span.end()
          }
        },
      ),
  }
}
```

Note: `methods` overrides `run` only — `step.run` returns the existing base method otherwise (which lives on the `step` object passed in). The other base methods (`waitFor`, `pause`, etc.) are still accessible because the engine merges `extra` over `step` (see `src/engine.ts:1128-1129`); overriding `run` shadows only that one method.

- [ ] **Step 4: Run all three step.run tests — they should pass**

Run: `npm run test:unit -- otel.test.ts -t "step.run"`
Expected: PASS.

- [ ] **Step 5: Run full unit suite — confirm no regressions**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): wrap step.run with span, cache-hit suppression, error path"
```

---

## Task 10: Spans for `waitFor`, `delay`, `waitUntil`, `pause`

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/plugins/otel.test.ts`:

```ts
it('emits spans for waitFor, delay, waitUntil, pause', async () => {
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-other-steps',
    async ({ step }) => {
      await step.waitFor('wf', { eventName: 'evt' })
      await step.delay('d', '1ms')
      await step.waitUntil('wu', new Date(Date.now() + 1))
      await step.pause('p')
      return 'ok'
    },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-other-steps', input: {} })

  // Workflow pauses immediately on first waitFor; resume it through completion.
  const drive = async () => {
    for (let i = 0; i < 20; i++) {
      const r = await engine.getRun({ runId: run.id })
      if (r.status === WorkflowStatus.PAUSED) break
      await new Promise((res) => setTimeout(res, 25))
    }
  }
  await drive()
  await engine.triggerEvent({ runId: run.id, eventName: 'evt' })
  await drive()
  // delay + waitUntil resolve themselves; pause needs an explicit resume
  await engine.resumeWorkflow({ runId: run.id })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }), { timeout: 5000 })
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  const stepNames = otel
    .getSpans()
    .map((s) => s.name)
    .filter((n) => n.startsWith('pg_workflows.step.'))
  expect(stepNames).toEqual(
    expect.arrayContaining([
      'pg_workflows.step.waitFor',
      'pg_workflows.step.delay',
      'pg_workflows.step.waitUntil',
      'pg_workflows.step.pause',
    ]),
  )
  const waitForSpan = otel.getSpansByName('pg_workflows.step.waitFor')[0]
  expect(waitForSpan.attributes).toMatchObject({ 'step.id': 'wf', 'step.type': 'waitFor' })
})
```

- [ ] **Step 2: Run test — should fail**

Run: `npm run test:unit -- otel.test.ts -t "spans for waitFor"`
Expected: FAIL.

- [ ] **Step 3: Extend `methods` with the four new wrappers**

In `src/plugins/otel.ts`, replace the `methods` field of the returned plugin with:

```ts
    methods: (step, context) => ({
      run: async <T>(stepId: string, handler: () => Promise<T>) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.run(stepId, handler)
        }
        return traceStep(
          tracer,
          `${prefix}.step.run`,
          { 'step.id': stepId, 'step.type': 'run' },
          () => step.run(stepId, handler),
        )
      },
      waitFor: ((stepId: string, opts: Parameters<StepBaseContext['waitFor']>[1]) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.waitFor(stepId, opts)
        }
        return traceStep(
          tracer,
          `${prefix}.step.waitFor`,
          { 'step.id': stepId, 'step.type': 'waitFor' },
          () => step.waitFor(stepId, opts) as Promise<unknown>,
        )
      }) as StepBaseContext['waitFor'],
      delay: async (stepId: string, duration: Parameters<StepBaseContext['delay']>[1]) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.delay(stepId, duration)
        }
        await traceStep(
          tracer,
          `${prefix}.step.delay`,
          { 'step.id': stepId, 'step.type': 'delay' },
          () => step.delay(stepId, duration),
        )
      },
      waitUntil: ((stepId: string, dateOrOptions: Parameters<StepBaseContext['waitUntil']>[1]) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.waitUntil(stepId, dateOrOptions)
        }
        return traceStep(
          tracer,
          `${prefix}.step.waitUntil`,
          { 'step.id': stepId, 'step.type': 'waitUntil' },
          () => step.waitUntil(stepId, dateOrOptions),
        )
      }) as StepBaseContext['waitUntil'],
      pause: async (stepId: string) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.pause(stepId)
        }
        await traceStep(
          tracer,
          `${prefix}.step.pause`,
          { 'step.id': stepId, 'step.type': 'pause' },
          () => step.pause(stepId),
        )
      },
    }),
```

The `as StepBaseContext['waitFor']` / `as StepBaseContext['waitUntil']` casts are required because both methods are overloaded — TypeScript can't infer the overload union from the implementation alone.

- [ ] **Step 4: Run test**

Run: `npm run test:unit -- otel.test.ts -t "spans for waitFor"`
Expected: PASS.

- [ ] **Step 5: Run full unit suite**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): wrap waitFor, delay, waitUntil, pause with spans"
```

---

## Task 11: `step.poll` span

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/plugins/otel.test.ts`:

```ts
it('emits step.poll span on each poll attempt', async () => {
  let attempt = 0
  const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-poll',
    async ({ step }) => {
      const result = await step.poll(
        'poller',
        async () => {
          attempt += 1
          return attempt >= 2 ? { value: attempt } : false
        },
        { interval: '30s', timeout: '60s' },
      )
      return result
    },
  )
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-poll', input: {} })

  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.PAUSED })

  // First execution emitted exactly one step.poll span
  const firstPolls = otel.getSpansByName('pg_workflows.step.poll')
  expect(firstPolls).toHaveLength(1)
  expect(firstPolls[0].attributes).toMatchObject({ 'step.id': 'poller', 'step.type': 'poll' })

  // Simulate the poll-interval re-fire via fastForwardWorkflow
  await engine.fastForwardWorkflow({ runId: run.id })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  // Second execution emits a new poll span (the previous one is not a cache hit
  // because the step's *output* is not yet in timeline, only a poll-state entry)
  expect(otel.getSpansByName('pg_workflows.step.poll').length).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm run test:unit -- otel.test.ts -t "step.poll"`
Expected: FAIL.

- [ ] **Step 3: Add `poll` wrapper to `methods`**

In `src/plugins/otel.ts`, inside the `methods` returned object (Task 10), add after `pause`:

```ts
      poll: (async <T>(
        stepId: string,
        conditionFn: () => Promise<T | false>,
        pollOptions?: Parameters<StepBaseContext['poll']>[2],
      ) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.poll(stepId, conditionFn, pollOptions)
        }
        return traceStep(
          tracer,
          `${prefix}.step.poll`,
          { 'step.id': stepId, 'step.type': 'poll' },
          () => step.poll(stepId, conditionFn, pollOptions),
        )
      }) as StepBaseContext['poll'],
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- otel.test.ts -t "step.poll"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): wrap step.poll with span"
```

---

## Task 12: `step.invokeChildWorkflow` span with binding-key cache check

**Files:**
- Modify: `src/plugins/otel.ts`
- Modify: `src/plugins/otel.test.ts`

The cache-hit detection for `invokeChildWorkflow` is different: an in-flight child resume has a binding entry (`__invokeChildWorkflow:<stepId>`) but no `[stepId].output` yet. We must skip the span in that case too.

- [ ] **Step 1: Write failing test**

Append to `src/plugins/otel.test.ts`:

```ts
it('emits invokeChildWorkflow span on creation and skips on cache-hit resume', async () => {
  const child = workflow('otel-child', async () => 'child-done')
  await engine.registerWorkflow(child)

  const parent = workflow.use(otelPlugin({ tracer: otel.tracer }))(
    'otel-parent',
    async ({ step }) => {
      const r = await step.invokeChildWorkflow('call-child', child)
      return r
    },
  )
  await engine.registerWorkflow(parent)
  const run = await engine.startWorkflow({ workflowId: 'otel-parent', input: {} })

  await expect
    .poll(async () => await engine.getRun({ runId: run.id }), { timeout: 5000 })
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  const invokeSpans = otel.getSpansByName('pg_workflows.step.invokeChildWorkflow')
  expect(invokeSpans).toHaveLength(1)
  expect(invokeSpans[0].attributes).toMatchObject({
    'step.id': 'call-child',
    'step.type': 'invokeChildWorkflow',
  })
})
```

The single-span assertion proves both behaviors: a span is emitted on the create-and-pause execution, and on the resume execution the cached binding (plus eventual cached output) prevents a duplicate span.

- [ ] **Step 2: Run — should fail**

Run: `npm run test:unit -- otel.test.ts -t "invokeChildWorkflow"`
Expected: FAIL.

- [ ] **Step 3: Import the binding-key helper and extend cache predicate**

In `src/plugins/otel.ts`, add an import at the top:

```ts
import { invokeChildWorkflowTimelineKey } from '../constants'
```

Replace `isCachedHit` with a kind-aware version:

```ts
function isCachedHit(
  timeline: Record<string, unknown>,
  stepId: string,
  kind: 'run' | 'waitFor' | 'delay' | 'waitUntil' | 'pause' | 'poll' | 'invokeChildWorkflow',
): boolean {
  const entry = timeline[stepId]
  if (
    entry &&
    typeof entry === 'object' &&
    'output' in entry &&
    (entry as { output: unknown }).output !== undefined
  ) {
    return true
  }
  if (kind === 'invokeChildWorkflow' && timeline[invokeChildWorkflowTimelineKey(stepId)]) {
    return true
  }
  return false
}
```

Update every existing caller in `methods` to pass the new `kind` arg. Example for `run`:

```ts
        if (isCachedHit(context.timeline, stepId, 'run')) {
          return step.run(stepId, handler)
        }
```

Apply the same pattern to `waitFor` ('waitFor'), `delay` ('delay'), `waitUntil` ('waitUntil'), `pause` ('pause'), `poll` ('poll').

- [ ] **Step 4: Add the `invokeChildWorkflow` wrapper to `methods`**

Inside the `methods` returned object, after `poll`, add:

```ts
      invokeChildWorkflow: (async (
        stepId: string,
        refOrParams: Parameters<StepBaseContext['invokeChildWorkflow']>[1],
        inputArg?: unknown,
        optionsArg?: unknown,
      ) => {
        if (isCachedHit(context.timeline, stepId, 'invokeChildWorkflow')) {
          return (step.invokeChildWorkflow as (
            ...args: unknown[]
          ) => Promise<unknown>)(stepId, refOrParams, inputArg, optionsArg)
        }
        return traceStep(
          tracer,
          `${prefix}.step.invokeChildWorkflow`,
          { 'step.id': stepId, 'step.type': 'invokeChildWorkflow' },
          () =>
            (step.invokeChildWorkflow as (
              ...args: unknown[]
            ) => Promise<unknown>)(stepId, refOrParams, inputArg, optionsArg),
        )
      }) as StepBaseContext['invokeChildWorkflow'],
```

- [ ] **Step 5: Run test**

Run: `npm run test:unit -- otel.test.ts -t "invokeChildWorkflow"`
Expected: PASS.

- [ ] **Step 6: Run full unit suite**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "feat(otel): wrap step.invokeChildWorkflow with binding-aware cache check"
```

---

## Task 13: Cache-hit predicate unit test

**Files:**
- Modify: `src/plugins/otel.test.ts`
- Modify: `src/plugins/otel.ts` (export `isCachedHit`)

- [ ] **Step 1: Export `isCachedHit` from the plugin module**

In `src/plugins/otel.ts`, change `function isCachedHit` to `export function isCachedHit`.

- [ ] **Step 2: Write the unit test**

Append to `src/plugins/otel.test.ts` *outside* the existing `describe('otelPlugin', ...)` block (top level inside the file):

```ts
import { invokeChildWorkflowTimelineKey } from '../constants'
import { isCachedHit } from './otel'

describe('isCachedHit', () => {
  it('returns true when output is recorded for stepId', () => {
    expect(isCachedHit({ s: { output: 'x', timestamp: new Date() } }, 's', 'run')).toBe(true)
  })

  it('returns false when output is undefined', () => {
    expect(isCachedHit({ s: { output: undefined, timestamp: new Date() } }, 's', 'run')).toBe(
      false,
    )
  })

  it('returns false when timeline has no entry for stepId', () => {
    expect(isCachedHit({}, 's', 'run')).toBe(false)
  })

  it('returns false for non-object entry', () => {
    expect(isCachedHit({ s: 'not-an-object' }, 's', 'run')).toBe(false)
  })

  it('returns true for invokeChildWorkflow when only the binding key is present', () => {
    const timeline = { [invokeChildWorkflowTimelineKey('s')]: { invokeChildWorkflow: {} } }
    expect(isCachedHit(timeline, 's', 'invokeChildWorkflow')).toBe(true)
    expect(isCachedHit(timeline, 's', 'run')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npm run test:unit -- otel.test.ts -t "isCachedHit"`
Expected: PASS (all 5 cases).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/otel.ts src/plugins/otel.test.ts
git commit -m "test(otel): direct coverage for isCachedHit predicate"
```

---

## Task 14: Plugin composition order with otelPlugin

**Files:**
- Modify: `src/plugins/otel.test.ts`

- [ ] **Step 1: Add composition test**

Append to the `describe('otelPlugin', ...)` block in `src/plugins/otel.test.ts`:

```ts
it('composes wrap with another plugin in registration order', async () => {
  const calls: string[] = []
  const trackerPlugin: WorkflowPlugin<StepBaseContext, object> = {
    name: 'tracker',
    methods: () => ({}),
    wrap: async (_ctx, next) => {
      calls.push('tracker:before')
      const r = await next()
      calls.push('tracker:after')
      return r
    },
  }

  const w = workflow
    .use(trackerPlugin)
    .use(otelPlugin({ tracer: otel.tracer }))('otel-compose', async () => 'ok')
  await engine.registerWorkflow(w)
  const run = await engine.startWorkflow({ workflowId: 'otel-compose', input: {} })
  await expect
    .poll(async () => await engine.getRun({ runId: run.id }))
    .toMatchObject({ status: WorkflowStatus.COMPLETED })

  // tracker registered first, so its wrap is outermost — its before runs
  // before the workflow.run span opens, and its after runs after the span ends.
  const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0]
  expect(wfSpan).toBeDefined()
  expect(calls).toEqual(['tracker:before', 'tracker:after'])
})
```

Add `import type { StepBaseContext, WorkflowPlugin } from '../types'` to the top of the file if not already present.

- [ ] **Step 2: Run test**

Run: `npm run test:unit -- otel.test.ts -t "composes wrap"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/otel.test.ts
git commit -m "test(otel): verify plugin composition order with another wrap"
```

---

## Task 15: Export `otelPlugin` and document

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Re-export from the main entry**

In `src/index.ts`, add:

```ts
export { otelPlugin, type OtelPluginOptions } from './plugins/otel'
```

- [ ] **Step 2: Add Observability section to README.md**

In `README.md`, add a new top-level section near the existing API documentation (preserve the project's tone and heading level — `##`):

````markdown
## Observability with OpenTelemetry

pg-workflows ships a first-party plugin that emits OTel spans for workflow and step execution. `@opentelemetry/api` is an optional peer dependency — install it only if you want tracing.

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { trace } from '@opentelemetry/api'
import { workflow, otelPlugin } from 'pg-workflows'

// Initialize your OTel SDK however you normally do — for Node apps the
// NodeSDK registers an AsyncHooks context manager, which is required for
// hierarchical (parent/child) spans across async boundaries.
new NodeSDK({ /* exporters, resource, ... */ }).start()

const tracedWorkflow = workflow.use(otelPlugin())

const myWorkflow = tracedWorkflow('checkout', async ({ step }) => {
  await step.run('charge', async () => { /* ... */ })
  await step.waitFor('await-shipment', { eventName: 'shipped' })
})
```

The plugin emits a `pg_workflows.workflow.run` span per worker execution (one per resume cycle), with child spans per step kind (`pg_workflows.step.run`, `pg_workflows.step.waitFor`, etc.). Spans carry `workflow.id`, `workflow.run_id`, `workflow.attempt` and, where set, `workflow.resource_id`. Steps replayed from cache after a pause emit no spans.

**Options:**

```ts
otelPlugin({
  tracer: trace.getTracer('my-app'),                // default: trace.getTracer('pg-workflows')
  spanNamePrefix: 'pg_workflows',                   // default shown
  attributes: (ctx) => ({ tenant: ctx.resourceId }), // extra static attrs on workflow.run
})
```

Metrics, distributed trace context propagation across child workflows, and HTTP-caller context propagation are not in v1 — see [the design doc](docs/superpowers/specs/2026-05-21-otel-instrumentation-design.md) for the deferral rationale.
````

- [ ] **Step 3: Add a bullet to AGENTS.md under Core API**

In `AGENTS.md` (which is also `CLAUDE.md`), find the `## Core API` section. Add a new subsection after the existing `WorkflowEngine` block:

```markdown
### `otelPlugin(options?)` - OpenTelemetry tracing

```typescript
import { workflow, otelPlugin } from 'pg-workflows';

// Optional peer dep: install `@opentelemetry/api` and an OTel SDK (e.g. NodeSDK).
// One `pg_workflows.workflow.run` span per worker execution, with child spans
// per step kind. Spans replayed from cache after a pause are suppressed.
const tracedWorkflow = workflow.use(otelPlugin({
  // tracer?: Tracer            // default: trace.getTracer('pg-workflows')
  // spanNamePrefix?: string    // default: 'pg_workflows'
  // attributes?: (ctx) => Record<string, AttributeValue>
}));
```
```

- [ ] **Step 4: Run full unit suite and build**

Run: `npm run test:unit`
Expected: all pass.

Run: `npm run build`
Expected: exits 0.

Run: `npm run lint`
Expected: exits 0 (or run `npm run lint:fix` and re-stage if Biome flags formatting).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md AGENTS.md
git commit -m "feat(otel): export otelPlugin and document usage"
```

---

## Verification before declaring done

- [ ] **Step 1: Full test suite passes**

Run: `npm test`
Expected: unit + integration both green. If integration requires a Postgres URL the user hasn't provided, run only `npm run test:unit` and note the gap.

- [ ] **Step 2: Build cleanly**

Run: `npm run clean && npm run build`
Expected: exits 0. `dist/` contains the plugin output.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean. Otherwise `npm run lint:fix` and re-stage anything modified.

- [ ] **Step 4: Spec coverage walk-through**

Open `docs/superpowers/specs/2026-05-21-otel-instrumentation-design.md` and confirm every "In scope" bullet has a matching task. Confirm every "Out of scope for v1" bullet is documented in the README's deferral pointer.
