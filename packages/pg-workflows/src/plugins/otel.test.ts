import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workflow } from '../definition';
import { WorkflowEngine } from '../engine';
import { getBoss } from '../tests/pgboss';
import { closeTestDatabase, createTestDatabase } from '../tests/test-db';
import type { StepBaseContext, WorkflowPlugin } from '../types';
import { WorkflowStatus } from '../types';
import { otelPlugin } from './otel';
import { setupOtel } from './otel-test-helpers';

let testBoss: PgBoss;
let testPool: pg.Pool;

beforeAll(async () => {
  testPool = await createTestDatabase();
  testBoss = await getBoss(testPool);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('otelPlugin', () => {
  let otel: ReturnType<typeof setupOtel>;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    otel = setupOtel();
    engine = new WorkflowEngine({ workflows: [], pool: testPool, boss: testBoss });
    await engine.start();
  });

  afterEach(async () => {
    await engine.stop();
    await otel.teardown();
  });

  it('registers and lets a workflow complete', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))('otel-smoke', async ({ step }) => {
      return await step.run('only', async () => 'ok');
    });
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-smoke', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED, output: 'ok' });
  });

  it('emits a workflow.run span on successful completion', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))('otel-wf-span', async () => 'done');
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({
      resourceId: 'tenant-1',
      workflowId: 'otel-wf-span',
      input: {},
    });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id, resourceId: 'tenant-1' }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    const spans = otel.getSpansByName('pg_workflows.workflow.run');
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes).toMatchObject({
      'workflow.id': 'otel-wf-span',
      'workflow.run_id': run.id,
      'workflow.resource_id': 'tenant-1',
      'workflow.attempt': 0,
    });
    expect(spans[0].status.code).toBe(1); // SpanStatusCode.OK
  });

  it('records exception and ERROR status on workflow.run when handler throws', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-wf-throw',
      async ({ step }) => {
        await step.run('boom', async () => {
          throw new Error('kaboom');
        });
      },
      { retries: 0 },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-wf-throw', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.FAILED });

    const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0];
    expect(wfSpan.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(wfSpan.status.message).toBe('kaboom');
    expect(wfSpan.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('emits step.run span as a child of workflow.run', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-step-run-child',
      async ({ step }) => {
        return await step.run('foo', async () => 'bar');
      },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-step-run-child', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0];
    const stepSpan = otel.getSpansByName('pg_workflows.step.run')[0];
    expect(stepSpan).toBeDefined();
    expect(stepSpan.attributes).toMatchObject({ 'step.id': 'foo', 'step.type': 'run' });
    expect(stepSpan.parentSpanId).toBe(wfSpan.spanContext().spanId);
  });

  it('skips step.run span on cache-hit replay', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-cache-skip',
      async ({ step }) => {
        const a = await step.run('first', async () => 'A');
        await step.waitFor('gate', { eventName: 'go' });
        const b = await step.run('second', async () => 'B');
        return { a, b };
      },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-cache-skip', input: {} });

    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.PAUSED });

    // First execution: workflow.run + step.run('first') + step.waitFor('gate')
    expect(
      otel.getSpansByName('pg_workflows.step.run').map((s) => s.attributes['step.id']),
    ).toEqual(['first']);

    await engine.triggerEvent({ runId: run.id, eventName: 'go' });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    // Second execution: NEW workflow.run + step.run('second') only.
    // 'first' is a cache hit and emits no span.
    const stepRunSpans = otel.getSpansByName('pg_workflows.step.run');
    const ids = stepRunSpans.map((s) => s.attributes['step.id']);
    expect(ids).toEqual(['first', 'second']);
    expect(otel.getSpansByName('pg_workflows.workflow.run')).toHaveLength(2);
  });

  it('records exception and ERROR status on step.run when handler throws', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-step-throw',
      async ({ step }) => {
        await step.run('explode', async () => {
          throw new Error('nope');
        });
      },
      { retries: 0 },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-step-throw', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.FAILED });

    const stepSpan = otel.getSpansByName('pg_workflows.step.run')[0];
    expect(stepSpan.status.code).toBe(2);
    expect(stepSpan.status.message).toBe('nope');
    expect(stepSpan.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('step.run span has non-zero duration matching the step handler runtime', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-step-duration',
      async ({ step }) => {
        return await step.run('slow', async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'done';
        });
      },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-step-duration', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    const stepSpan = otel.getSpansByName('pg_workflows.step.run')[0];
    expect(stepSpan).toBeDefined();
    // Span duration = endTime - startTime in nanoseconds. With a 50ms sleep
    // inside the handler, we expect at least ~30ms (allow generous margin).
    const startNs = stepSpan.startTime[0] * 1_000_000_000 + stepSpan.startTime[1];
    const endNs = stepSpan.endTime[0] * 1_000_000_000 + stepSpan.endTime[1];
    const durationMs = (endNs - startNs) / 1_000_000;
    expect(durationMs).toBeGreaterThan(30);
  });

  it('emits spans for waitFor, delay, waitUntil, pause', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-other-steps',
      async ({ step }) => {
        await step.waitFor('wf', { eventName: 'evt' });
        await step.delay('d', '1ms');
        await step.waitUntil('wu', new Date(Date.now() + 1));
        await step.pause('p');
        return 'ok';
      },
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-other-steps', input: {} });

    // Workflow pauses immediately on first waitFor; drive it through completion.
    const drive = async (stepId?: string) => {
      for (let i = 0; i < 40; i++) {
        const r = await engine.getRun({ runId: run.id });
        if (r.status === WorkflowStatus.PAUSED && (!stepId || r.currentStepId === stepId)) break;
        await new Promise((res) => setTimeout(res, 50));
      }
    };
    await drive('wf');
    await engine.triggerEvent({ runId: run.id, eventName: 'evt' });
    // delay + waitUntil resolve themselves; wait until paused at the explicit pause step.
    await drive('p');
    await engine.resumeWorkflow({ runId: run.id });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }), { timeout: 5000 })
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    const stepNames = otel
      .getSpans()
      .map((s) => s.name)
      .filter((n) => n.startsWith('pg_workflows.step.'));
    expect(stepNames).toEqual(
      expect.arrayContaining([
        'pg_workflows.step.waitFor',
        'pg_workflows.step.delay',
        'pg_workflows.step.waitUntil',
        'pg_workflows.step.pause',
      ]),
    );
    const waitForSpan = otel.getSpansByName('pg_workflows.step.waitFor')[0];
    expect(waitForSpan.attributes).toMatchObject({ 'step.id': 'wf', 'step.type': 'waitFor' });
  });

  it('emits invokeChildWorkflow span on creation and skips on cache-hit resume', async () => {
    const child = workflow('otel-child', async ({ step }) =>
      step.run('done', async () => 'child-done'),
    );
    await engine.registerWorkflow(child);

    const parent = workflow.use(otelPlugin({ tracer: otel.tracer }))(
      'otel-parent',
      async ({ step }) => {
        const r = await step.invokeChildWorkflow('call-child', {
          workflowId: child.id,
          input: {},
        });
        return r;
      },
    );
    await engine.registerWorkflow(parent);
    const run = await engine.startWorkflow({ workflowId: 'otel-parent', input: {} });

    await expect
      .poll(async () => await engine.getRun({ runId: run.id }), { timeout: 5000 })
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    const invokeSpans = otel.getSpansByName('pg_workflows.step.invokeChildWorkflow');
    expect(invokeSpans).toHaveLength(1);
    expect(invokeSpans[0].attributes).toMatchObject({
      'step.id': 'call-child',
      'step.type': 'invokeChildWorkflow',
    });
  });

  it('emits step.poll span on each poll attempt', async () => {
    let attempt = 0;
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))('otel-poll', async ({ step }) => {
      const result = await step.poll(
        'poller',
        async () => {
          attempt += 1;
          return attempt >= 2 ? { value: attempt } : false;
        },
        { interval: '30s', timeout: '60s' },
      );
      return result;
    });
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-poll', input: {} });

    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.PAUSED });

    // First execution emitted exactly one step.poll span
    const firstPolls = otel.getSpansByName('pg_workflows.step.poll');
    expect(firstPolls).toHaveLength(1);
    expect(firstPolls[0].attributes).toMatchObject({ 'step.id': 'poller', 'step.type': 'poll' });

    // Simulate the poll-interval re-fire via fastForwardWorkflow
    await engine.fastForwardWorkflow({ runId: run.id });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    // Second execution emits a new poll span (the previous one is not a cache hit
    // because the step's *output* is not yet in timeline, only a poll-state entry)
    expect(otel.getSpansByName('pg_workflows.step.poll').length).toBeGreaterThanOrEqual(2);
  });

  it('wraps step.sleep (alias for step.delay) with a span', async () => {
    const w = workflow.use(otelPlugin({ tracer: otel.tracer }))('otel-sleep', async ({ step }) => {
      await step.sleep('napping', '1ms');
      return 'ok';
    });
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-sleep', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }), { timeout: 5000 })
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    // sleep is an alias for delay — the span name should be pg_workflows.step.delay
    // so users can search uniformly for "delay" spans regardless of the alias used.
    const delaySpans = otel.getSpansByName('pg_workflows.step.delay');
    expect(delaySpans.some((s) => s.attributes['step.id'] === 'napping')).toBe(true);
  });

  it('composes wrap with another plugin in registration order', async () => {
    const calls: string[] = [];
    const trackerPlugin: WorkflowPlugin<StepBaseContext, object> = {
      name: 'tracker',
      methods: () => ({}),
      wrap: async (_ctx, next) => {
        calls.push('tracker:before');
        const r = await next();
        calls.push('tracker:after');
        return r;
      },
    };

    const w = workflow.use(trackerPlugin).use(otelPlugin({ tracer: otel.tracer }))(
      'otel-compose',
      async () => 'ok',
    );
    await engine.registerWorkflow(w);
    const run = await engine.startWorkflow({ workflowId: 'otel-compose', input: {} });
    await expect
      .poll(async () => await engine.getRun({ runId: run.id }))
      .toMatchObject({ status: WorkflowStatus.COMPLETED });

    // tracker registered first, so its wrap is outermost — its before runs
    // before the workflow.run span opens, and its after runs after the span ends.
    const wfSpan = otel.getSpansByName('pg_workflows.workflow.run')[0];
    expect(wfSpan).toBeDefined();
    expect(calls).toEqual(['tracker:before', 'tracker:after']);
  });
});

import { invokeChildWorkflowTimelineKey } from '../constants';
import { isCachedHit } from './otel';

describe('isCachedHit', () => {
  it('returns true when output is recorded for stepId', () => {
    expect(isCachedHit({ s: { output: 'x', timestamp: new Date() } }, 's', 'run')).toBe(true);
  });

  it('returns false when output is undefined', () => {
    expect(isCachedHit({ s: { output: undefined, timestamp: new Date() } }, 's', 'run')).toBe(
      false,
    );
  });

  it('returns false when timeline has no entry for stepId', () => {
    expect(isCachedHit({}, 's', 'run')).toBe(false);
  });

  it('returns false for non-object entry', () => {
    expect(isCachedHit({ s: 'not-an-object' }, 's', 'run')).toBe(false);
  });

  it('returns true for invokeChildWorkflow when only the binding key is present', () => {
    const timeline = { [invokeChildWorkflowTimelineKey('s')]: { invokeChildWorkflow: {} } };
    expect(isCachedHit(timeline, 's', 'invokeChildWorkflow')).toBe(true);
    expect(isCachedHit(timeline, 's', 'run')).toBe(false);
  });
});
