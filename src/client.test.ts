import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WorkflowClient } from './client';
import { createWorkflowRef } from './definition';
import { closeTestDatabase, createTestDatabase } from './tests/test-db';

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
});
