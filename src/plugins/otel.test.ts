import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workflow } from '../definition';
import { WorkflowEngine } from '../engine';
import { getBoss } from '../tests/pgboss';
import { closeTestDatabase, createTestDatabase } from '../tests/test-db';
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
});
