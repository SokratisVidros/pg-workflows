import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WorkflowClient } from './client';
import { createWorkflowRef } from './definition';
import { closeTestDatabase, createTestDatabase } from './tests/test-db';
import { WorkflowStatus } from './types';

let testPool: pg.Pool;

beforeAll(async () => {
  testPool = await createTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

const testRef = createWorkflowRef('test-client-workflow', {
  inputSchema: z.object({ data: z.string() }),
});

describe('WorkflowClient', () => {
  const resourceId = 'testResourceId';
  let client: WorkflowClient;

  beforeEach(async () => {
    client = new WorkflowClient({ pool: testPool });
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('startWorkflow idempotency', () => {
    it('returns the same run when called twice with the same idempotencyKey (params overload)', async () => {
      const run1 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'hello' },
        idempotencyKey: 'client-key-1',
      });

      const run2 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'hello' },
        idempotencyKey: 'client-key-1',
      });

      expect(run1.id).toBe(run2.id);
      expect(run1.idempotencyKey).toBe('client-key-1');
      expect(run2.idempotencyKey).toBe('client-key-1');
    });

    it('returns the same run when called twice with the same idempotencyKey (ref overload)', async () => {
      const run1 = await client.startWorkflow(
        testRef,
        { data: 'hello' },
        { resourceId, idempotencyKey: 'client-key-ref-1' },
      );

      const run2 = await client.startWorkflow(
        testRef,
        { data: 'hello' },
        { resourceId, idempotencyKey: 'client-key-ref-1' },
      );

      expect(run1.id).toBe(run2.id);
      expect(run1.idempotencyKey).toBe('client-key-ref-1');
      expect(run2.idempotencyKey).toBe('client-key-ref-1');
    });

    it('creates two runs when no idempotencyKey is provided', async () => {
      const run1 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'a' },
      });

      const run2 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'b' },
      });

      expect(run1.id).not.toBe(run2.id);
      expect(run1.idempotencyKey).toBeNull();
      expect(run2.idempotencyKey).toBeNull();
    });

    it('creates two runs when different idempotencyKeys are provided', async () => {
      const run1 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'x' },
        idempotencyKey: 'client-key-a',
      });

      const run2 = await client.startWorkflow({
        resourceId,
        workflowId: 'test-client-workflow',
        input: { data: 'y' },
        idempotencyKey: 'client-key-b',
      });

      expect(run1.id).not.toBe(run2.id);
      expect(run1.idempotencyKey).toBe('client-key-a');
      expect(run2.idempotencyKey).toBe('client-key-b');
    });
  });

  describe('boss option', () => {
    it('uses the provided pg-boss instance (and its schema)', async () => {
      const customSchema = 'custom_client_schema';
      const customBoss = new PgBoss({
        db: {
          executeSql: (text: string, values?: unknown[]) =>
            testPool.query(text, values) as Promise<{ rows: unknown[] }>,
        },
        schema: customSchema,
      });

      const customClient = new WorkflowClient({
        pool: testPool,
        boss: customBoss,
      });
      await customClient.start();

      const schemas = await testPool.query('SELECT nspname FROM pg_namespace WHERE nspname = $1', [
        customSchema,
      ]);
      expect(schemas.rows).toHaveLength(1);

      await customClient.stop();
    });
  });

  describe('fastForwardWorkflow', () => {
    it('should no-op for invokeChildWorkflow waits', async () => {
      const run = await client.startWorkflow({
        resourceId,
        workflowId: 'client-fast-forward-invoke',
        input: {},
      });

      await testPool.query(
        `UPDATE workflow_runs
         SET status = $1, current_step_id = $2, paused_at = $3, timeline = $4
         WHERE id = $5`,
        [
          WorkflowStatus.PAUSED,
          'call-child',
          new Date(),
          JSON.stringify({
            'call-child-invoke-child-workflow': {
              invokeChildWorkflow: {
                childRunId: 'run_child_for_client_fast_forward',
                childWorkflowId: 'client-child-workflow',
              },
              timestamp: new Date().toISOString(),
            },
            'call-child-wait-for': {
              waitFor: {
                eventName: '__invoke_child_workflow_completed:run_child_for_client_fast_forward',
              },
              timestamp: new Date().toISOString(),
            },
          }),
          run.id,
        ],
      );

      const boss = (client as unknown as { boss: PgBoss }).boss;
      const sendSpy = vi.spyOn(boss, 'send');
      try {
        const resumeResult = await client.resumeWorkflow({
          runId: run.id,
          resourceId,
        });
        expect(resumeResult.status).toBe(WorkflowStatus.PAUSED);
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        sendSpy.mockRestore();
      }

      const result = await client.fastForwardWorkflow({
        runId: run.id,
        resourceId,
        data: { fake: true },
      });

      expect(result.status).toBe(WorkflowStatus.PAUSED);

      const current = await client.getRun({ runId: run.id, resourceId });
      expect(current.status).toBe(WorkflowStatus.PAUSED);
      expect(current.timeline).not.toHaveProperty('call-child.output');
    });
  });
});
