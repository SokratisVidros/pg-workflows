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
});
