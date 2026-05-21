import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import * as v from 'valibot';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WORKFLOW_RUN_DLQ_QUEUE_NAME, WORKFLOW_RUN_QUEUE_NAME } from './constants';
import type { WorkflowRun } from './db/types';
import { workflow } from './definition';
import { WorkflowEngine } from './engine';
import { WorkflowEngineError, WorkflowRunNotFoundError } from './error';
import { getBoss } from './tests/pgboss';
import { closeTestDatabase, createTestDatabase } from './tests/test-db';
import type { StepBaseContext, WorkflowPlugin } from './types';
import { WorkflowStatus } from './types';

let testBoss: PgBoss;
let testPool: pg.Pool;

beforeAll(async () => {
  testPool = await createTestDatabase();
  testBoss = await getBoss(testPool);
});

afterAll(async () => {
  await closeTestDatabase();
});

const testWorkflow = workflow(
  'test-workflow',
  async ({ step, input }) => {
    return await step.run('step-1', async () => {
      return { result: input.data };
    });
  },
  {
    inputSchema: z.object({
      data: z.string(),
    }),
  },
);

describe('WorkflowEngine', () => {
  const resourceId = 'testResourceId';

  describe('start(asEngine = true)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should register workflows on start', async () => {
      await engine.start(false);
      expect(engine.workflows.size).toBe(1);
      expect(engine.workflows.get('test-workflow')).toBeDefined();
    });

    it('should not start twice', async () => {
      const registerWorkflowSpy = vi.spyOn(engine, 'registerWorkflow');
      await engine.start(false);
      expect(registerWorkflowSpy).toHaveBeenCalledOnce();

      registerWorkflowSpy.mockClear();
      await engine.start(false);
      expect(registerWorkflowSpy).not.toHaveBeenCalled();
    });
  });

  describe('registerWorkflow(workflow)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start(false);
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should register a simple workflow', async () => {
      const testWorkflow2 = workflow('test-workflow-2', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.waitFor('step-2', { eventName: 'user-action' });
        await step.pause('step-3');
        await step.run('step-4', async () => 'result-4');
        return 'completed';
      });

      await engine.registerWorkflow(testWorkflow2);
      expect(engine.workflows.size).toBe(2);
      expect(engine.workflows.get('test-workflow')?.steps).toEqual([
        {
          id: 'step-1',
          type: 'run',
          conditional: false,
          loop: false,
          isDynamic: false,
        },
      ]);
      expect(engine.workflows.get('test-workflow-2')?.steps).toEqual([
        {
          id: 'step-1',
          type: 'run',
          conditional: false,
          loop: false,
          isDynamic: false,
        },
        {
          id: 'step-2',
          type: 'waitFor',
          conditional: false,
          loop: false,
          isDynamic: false,
        },
        {
          id: 'step-3',
          type: 'pause',
          conditional: false,
          loop: false,
          isDynamic: false,
        },
        {
          id: 'step-4',
          type: 'run',
          conditional: false,
          loop: false,
          isDynamic: false,
        },
      ]);
    });

    it('should throw error when registering duplicate workflow', async () => {
      await expect(engine.registerWorkflow(testWorkflow)).rejects.toThrow(WorkflowEngineError);
    });

    it('should throw error when step is defined twice', async () => {
      const invalidWorkflow = workflow('test-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.run('step-1', async () => 'result-1');
      });

      await expect(engine.registerWorkflow(invalidWorkflow)).rejects.toThrow(WorkflowEngineError);
    });
  });

  describe('workflow.use(plugin)', () => {
    const doublePlugin: WorkflowPlugin<
      StepBaseContext,
      { double: (stepId: string, n: number) => Promise<number> }
    > = {
      name: 'double',
      methods: (step) => ({
        double: (stepId, n) => step.run(stepId, async () => n * 2),
      }),
    };

    it('should return a callable that produces a definition with plugins array', () => {
      const withPlugin = workflow.use(doublePlugin);
      const def = withPlugin('plugin-workflow', async ({ step }) => {
        const x = await step.double('double-step', 21);
        return { value: x };
      });
      expect(def.id).toBe('plugin-workflow');
      expect(def.plugins).toBeDefined();
      expect(def.plugins).toHaveLength(1);
      expect(def.plugins?.[0].name).toBe('double');
    });

    it('should support chaining multiple plugins', () => {
      const greetPlugin: WorkflowPlugin<
        StepBaseContext,
        { greet: (stepId: string, name: string) => Promise<string> }
      > = {
        name: 'greet',
        methods: (step) => ({
          greet: (stepId, name) => step.run(stepId, async () => `Hello, ${name}`),
        }),
      };
      const w = workflow.use(doublePlugin).use(greetPlugin);
      const def = w('chained-workflow', async ({ step }) => {
        const g = await step.greet('g', 'World');
        const d = await step.double('d', 3);
        return { g, d };
      });
      expect(def.plugins).toHaveLength(2);
      expect(def.plugins?.[0].name).toBe('double');
      expect(def.plugins?.[1].name).toBe('greet');
    });

    it('should extend step with plugin methods at runtime and complete workflow', async () => {
      const engine = new WorkflowEngine({
        workflows: [],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();

      const pluginWorkflow = workflow.use(doublePlugin)(
        'plugin-exec-workflow',
        async ({ step }) => {
          const a = await step.double('double-a', 5);
          const b = await step.double('double-b', 10);
          return { a, b };
        },
      );
      await engine.registerWorkflow(pluginWorkflow);

      const run = await engine.startWorkflow({
        resourceId: 'plugin-test-resource',
        workflowId: 'plugin-exec-workflow',
        input: {},
      });

      await expect
        .poll(
          async () => await engine.getRun({ runId: run.id, resourceId: 'plugin-test-resource' }),
        )
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { a: 10, b: 20 },
          timeline: {
            'double-a': { output: 10 },
            'double-b': { output: 20 },
          },
        });

      await engine.stop();
    });

    it('should pass base step (run, waitFor, pause) to handler alongside plugin methods', async () => {
      const engine = new WorkflowEngine({
        workflows: [],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();

      const pluginWorkflow = workflow.use(doublePlugin)(
        'plugin-with-base-steps',
        async ({ step }) => {
          const x = await step.run('plain-run', async () => 'ok');
          const d = await step.double('plugin-double', 7);
          expect(step.run).toBeDefined();
          expect(step.waitFor).toBeDefined();
          expect(step.pause).toBeDefined();
          expect(step.double).toBeDefined();
          return { x, d };
        },
      );
      await engine.registerWorkflow(pluginWorkflow);

      const run = await engine.startWorkflow({
        resourceId: 'plugin-base-resource',
        workflowId: 'plugin-with-base-steps',
        input: {},
      });

      await expect
        .poll(
          async () => await engine.getRun({ runId: run.id, resourceId: 'plugin-base-resource' }),
        )
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { x: 'ok', d: 14 },
        });

      await engine.stop();
    });

    it('should call plugin.wrap around the handler and compose multiple wraps in registration order', async () => {
      const calls: string[] = [];

      const outerPlugin: WorkflowPlugin<StepBaseContext, object> = {
        name: 'outer',
        methods: () => ({}),
        wrap: async (_ctx, next) => {
          calls.push('outer:before');
          const result = await next();
          calls.push('outer:after');
          return result;
        },
      };

      const innerPlugin: WorkflowPlugin<StepBaseContext, object> = {
        name: 'inner',
        methods: () => ({}),
        wrap: async (_ctx, next) => {
          calls.push('inner:before');
          const result = await next();
          calls.push('inner:after');
          return result;
        },
      };

      const engine = new WorkflowEngine({ workflows: [], pool: testPool, boss: testBoss });
      await engine.start();

      const wrapped = workflow.use(outerPlugin).use(innerPlugin)(
        'wrap-order-workflow',
        async ({ step }) => {
          calls.push('handler');
          await step.run('only-step', async () => 'ok');
          return 'done';
        },
      );

      await engine.registerWorkflow(wrapped);
      const run = await engine.startWorkflow({ workflowId: 'wrap-order-workflow', input: {} });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id }))
        .toMatchObject({ status: WorkflowStatus.COMPLETED });

      expect(calls).toEqual([
        'outer:before',
        'inner:before',
        'handler',
        'inner:after',
        'outer:after',
      ]);

      await engine.stop();
    });
  });

  describe('unregisterWorkflow()', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start(false);
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should unregister a workflow', async () => {
      await engine.unregisterWorkflow('test-workflow');
      expect(engine.workflows.size).toBe(0);
    });
  });

  describe('unregisterAllWorkflows()', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start(false);
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should unregister all workflows', async () => {
      await engine.unregisterAllWorkflows();
      expect(engine.workflows.size).toBe(0);
    });
  });

  describe('startWorkflow(workflowId, input, options)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should start a simple workflow and complete it', async () => {
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'test-workflow',
        input: { data: '42' },
      });

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 0,
        totalSteps: 1,
        completedSteps: 0,
      });

      expect(run).toBeDefined();
      expect(run.workflowId).toBe('test-workflow');
      expect(run.status).toBe(WorkflowStatus.RUNNING);
      expect(run.input).toEqual({ data: '42' });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.COMPLETED);

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 100,
        totalSteps: 1,
        completedSteps: 1,
      });
    });

    it('should start and complete without resourceId', async () => {
      const run = await engine.startWorkflow({
        workflowId: 'test-workflow',
        input: { data: 'no-resource' },
      });

      expect(run.resourceId).toBeNull();

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id })).status)
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id });
      expect(completed.output).toEqual({ result: 'no-resource' });
    });

    it('should start workflow with options', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: {
          data: '42',
        },
        options: {
          timeout: 5000,
          retries: 3,
        },
      });

      expect(run).toBeDefined();
      expect(run.maxRetries).toBe(3);
      expect(run.timeoutAt).toBeDefined();
    });

    it('should throw error for unknown workflow', async () => {
      await expect(
        engine.startWorkflow({
          resourceId: 'testResourceId',
          workflowId: 'unknown-workflow',
          input: { data: 'test' },
        }),
      ).rejects.toThrow(WorkflowEngineError);
    });

    it('should throw WorkflowEngineError when input does not match schema', async () => {
      await expect(
        engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 123 },
        }),
      ).rejects.toThrow(WorkflowEngineError);

      await expect(
        engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: {},
        }),
      ).rejects.toThrow(WorkflowEngineError);
    });

    it('should throw WorkflowEngineError when input does not match valibot schema', async () => {
      const valibotWorkflow = workflow(
        'valibot-workflow',
        async ({ step, input }) => {
          return await step.run('step-1', async () => {
            return { result: input.name };
          });
        },
        {
          inputSchema: v.object({
            name: v.string(),
            age: v.pipe(v.number(), v.integer(), v.minValue(0)),
          }),
        },
      );

      await engine.registerWorkflow(valibotWorkflow);

      await expect(
        engine.startWorkflow({
          resourceId,
          workflowId: 'valibot-workflow',
          input: { name: 123, age: 'not a number' },
        }),
      ).rejects.toThrow(WorkflowEngineError);

      await expect(
        engine.startWorkflow({
          resourceId,
          workflowId: 'valibot-workflow',
          input: {},
        }),
      ).rejects.toThrow(WorkflowEngineError);
    });

    it('should throw error for workflow without steps', async () => {
      const emptyWorkflow = workflow('empty-workflow', async () => {});

      await engine.registerWorkflow(emptyWorkflow);
      await expect(
        engine.startWorkflow({
          resourceId: 'testResourceId',
          workflowId: 'empty-workflow',
          input: {},
        }),
      ).rejects.toThrow(WorkflowEngineError);
    });

    describe('idempotency', () => {
      it('should return the same run when called twice with the same idempotencyKey', async () => {
        const run1 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'hello' },
          idempotencyKey: 'test-key-1',
        });

        const run2 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'hello' },
          idempotencyKey: 'test-key-1',
        });

        expect(run1.id).toBe(run2.id);
        expect(run1.idempotencyKey).toBe('test-key-1');
        expect(run2.idempotencyKey).toBe('test-key-1');
      });

      it('should create two runs when no idempotencyKey is provided', async () => {
        const run1 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'a' },
        });

        const run2 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'b' },
        });

        expect(run1.id).not.toBe(run2.id);
        expect(run1.idempotencyKey).toBeNull();
        expect(run2.idempotencyKey).toBeNull();
      });

      it('should create two runs when different idempotencyKeys are provided', async () => {
        const run1 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'x' },
          idempotencyKey: 'key-a',
        });

        const run2 = await engine.startWorkflow({
          resourceId,
          workflowId: 'test-workflow',
          input: { data: 'y' },
          idempotencyKey: 'key-b',
        });

        expect(run1.id).not.toBe(run2.id);
        expect(run1.idempotencyKey).toBe('key-a');
        expect(run2.idempotencyKey).toBe('key-b');
      });
    });

    it('should fall back to options.resourceId / options.idempotencyKey when not passed at the top level', async () => {
      // Documents the resolveWorkflowRunParameters behavior: for the params-
      // object form, `resourceId` and `idempotencyKey` may be supplied either
      // at the top level OR nested in `options`, and the top level wins.
      const run = await engine.startWorkflow({
        workflowId: 'test-workflow',
        input: { data: 'options-fallback' },
        options: {
          resourceId: 'options-resource',
          idempotencyKey: 'options-fallback-key',
        },
      });

      expect(run.resourceId).toBe('options-resource');
      expect(run.idempotencyKey).toBe('options-fallback-key');

      const sameRun = await engine.startWorkflow({
        workflowId: 'test-workflow',
        input: { data: 'options-fallback-2' },
        options: {
          resourceId: 'options-resource',
          idempotencyKey: 'options-fallback-key',
        },
      });
      expect(sameRun.id).toBe(run.id);
    });

    it('should roll back the workflow_runs insert when boss.send fails', async () => {
      const sendSpy = vi.spyOn(testBoss, 'send').mockImplementation(async () => {
        throw new Error('simulated boss.send failure');
      });

      try {
        await expect(
          engine.startWorkflow({
            resourceId,
            workflowId: 'test-workflow',
            input: { data: 'rollback-me' },
            idempotencyKey: 'rollback-test-key',
          }),
        ).rejects.toThrow('simulated boss.send failure');
      } finally {
        sendSpy.mockRestore();
      }

      // The transactional send means the workflow_runs row must NOT exist
      // because the boss.send failure rolled back the parent transaction.
      const remaining = await testPool.query(
        'SELECT id FROM workflow_runs WHERE idempotency_key = $1',
        ['rollback-test-key'],
      );
      expect(remaining.rows).toHaveLength(0);
    });
  });

  describe('pauseWorkflow(runId)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should pause a workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: {
          data: '42',
        },
      });
      expect(run.status).toBe(WorkflowStatus.RUNNING);

      const pausedRun = await engine.pauseWorkflow({
        runId: run.id,
        resourceId,
      });
      expect(pausedRun.status).toBe(WorkflowStatus.PAUSED);
      expect(pausedRun.pausedAt).toBeDefined();
    });

    it('should reject pausing a completed workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: { data: '42' },
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 3000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      await expect(engine.pauseWorkflow({ runId: run.id, resourceId })).rejects.toThrow(
        WorkflowEngineError,
      );
    });

    it('should reject pausing a cancelled workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: { data: '42' },
      });

      await engine.cancelWorkflow({ runId: run.id, resourceId });

      await expect(engine.pauseWorkflow({ runId: run.id, resourceId })).rejects.toThrow(
        WorkflowEngineError,
      );
    });
  });

  describe('resumeWorkflow(runId)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should resume a workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: {
          data: '42',
        },
      });
      expect(run.status).toBe(WorkflowStatus.RUNNING);

      const pausedRun = await engine.pauseWorkflow({
        runId: run.id,
        resourceId,
      });
      expect(pausedRun.status).toBe(WorkflowStatus.PAUSED);

      await engine.resumeWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 3000,
        })
        .toBe(WorkflowStatus.COMPLETED);
    });

    it('should reject resuming a running workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: { data: '42' },
      });
      expect(run.status).toBe(WorkflowStatus.RUNNING);

      await expect(engine.resumeWorkflow({ runId: run.id, resourceId })).rejects.toThrow(
        WorkflowEngineError,
      );
    });
  });

  describe('cancelWorkflow(runId)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start(false);
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should cancel a workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: {
          data: '42',
        },
      });
      expect(run.status).toBe(WorkflowStatus.RUNNING);

      const cancelledRun = await engine.cancelWorkflow({
        runId: run.id,
        resourceId,
      });
      expect(cancelledRun.status).toBe(WorkflowStatus.CANCELLED);
    });

    it('should reject cancelling an already cancelled workflow', async () => {
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: { data: '42' },
      });

      await engine.cancelWorkflow({ runId: run.id, resourceId });

      await expect(engine.cancelWorkflow({ runId: run.id, resourceId })).rejects.toThrow(
        WorkflowEngineError,
      );
    });

    it('should reject cancelling a completed workflow', async () => {
      const engine2 = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine2.start();

      const run = await engine2.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'test-workflow',
        input: { data: '42' },
      });

      await expect
        .poll(async () => (await engine2.getRun({ runId: run.id, resourceId })).status, {
          timeout: 3000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      await expect(engine2.cancelWorkflow({ runId: run.id, resourceId })).rejects.toThrow(
        WorkflowEngineError,
      );

      await engine2.stop();
    });
  });

  describe('workflow execution', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should handle workflow with waitFor step', async () => {
      const waitForWorkflow = workflow('wait-for-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.waitFor('step-2', { eventName: 'user-action' });
        return 'completed';
      });

      await engine.registerWorkflow(waitForWorkflow);
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'wait-for-workflow',
        input: {},
      });

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 0,
        totalSteps: 2,
        completedSteps: 0,
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 50,
        totalSteps: 2,
        completedSteps: 1,
      });

      await engine.triggerEvent({
        runId: run.id,
        resourceId,
        eventName: 'user-action',
        data: { accepted: true },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'completed',
          timeline: {
            'step-1': {
              output: 'result-1',
            },
            'step-2-wait-for': {
              waitFor: {
                eventName: 'user-action',
              },
            },
            'step-2': {
              output: { accepted: true },
            },
          },
        });

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 100,
        totalSteps: 2,
        completedSteps: 2,
      });
    });

    it('should complete waitFor when triggerEvent omits resourceId for a scoped run', async () => {
      const waitForWorkflowScoped = workflow(
        'wait-for-workflow-scoped-trigger',
        async ({ step }) => {
          await step.run('step-1', async () => 'result-1');
          await step.waitFor('step-2', { eventName: 'user-action' });
          return 'completed';
        },
      );

      await engine.registerWorkflow(waitForWorkflowScoped);
      const scopedResource = 'scoped-tenant-trigger-test';
      const run = await engine.startWorkflow({
        resourceId: scopedResource,
        workflowId: 'wait-for-workflow-scoped-trigger',
        input: {},
      });

      await expect
        .poll(
          async () => (await engine.getRun({ runId: run.id, resourceId: scopedResource })).status,
        )
        .toBe(WorkflowStatus.PAUSED);

      await engine.triggerEvent({
        runId: run.id,
        eventName: 'user-action',
        data: { accepted: true },
      });

      await expect
        .poll(
          async () => (await engine.getRun({ runId: run.id, resourceId: scopedResource })).status,
        )
        .toBe(WorkflowStatus.COMPLETED);
    });

    it('should invoke a child workflow and resume the parent with child output', async () => {
      const childWorkflow = workflow('invoke-child-success', async ({ step }) => {
        const event = await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { child: event };
      });

      const parentWorkflow = workflow('invoke-parent-success', async ({ step }) => {
        const childOutput = await step.invokeChildWorkflow<{ child: { message: string } }>(
          'call-child',
          {
            workflowId: 'invoke-child-success',
            input: {},
          },
        );
        return { childOutput };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-success',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.PAUSED,
          currentStepId: 'call-child',
          timeline: {
            'call-child-invoke-child-workflow': {
              invokeChildWorkflow: {
                childWorkflowId: 'invoke-child-success',
              },
            },
            'call-child-wait-for': {
              waitFor: {
                skipOutput: true,
              },
            },
          },
        });

      const childRuns = await engine.getRuns({ resourceId, workflowId: 'invoke-child-success' });
      expect(childRuns.items).toHaveLength(1);
      const childRun = childRuns.items[0];
      expect(childRun.parentRunId).toBe(parentRun.id);
      expect(childRun.parentStepId).toBe('call-child');
      expect(childRun.parentResourceId).toBe(resourceId);
      expect(childRun.idempotencyKey).toBeNull();

      const sendSpy = vi.spyOn(testBoss, 'send');
      try {
        const resumeAttempt = await engine.resumeWorkflow({
          runId: parentRun.id,
          resourceId,
        });
        expect(resumeAttempt.status).toBe(WorkflowStatus.PAUSED);
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        sendSpy.mockRestore();
      }

      await engine.triggerEvent({
        runId: childRun.id,
        resourceId,
        eventName: 'child-ready',
        data: { message: 'done' },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { childOutput: { child: { message: 'done' } } },
          timeline: {
            'call-child': {
              output: { child: { message: 'done' } },
            },
          },
        });
    });

    it('should preserve null output from an invoked child workflow', async () => {
      const childWorkflow = workflow('invoke-child-null-output', async ({ step }) => {
        return await step.run('child-step', async () => null);
      });

      const parentWorkflow = workflow('invoke-parent-null-output', async ({ step }) => {
        const childOutput = await step.invokeChildWorkflow<null>('call-child', {
          workflowId: 'invoke-child-null-output',
          input: {},
        });
        return { childOutput };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-null-output',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10_000,
        })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { childOutput: null },
          timeline: {
            'call-child': {
              output: null,
            },
          },
        });
    });

    it('should not start duplicate child workflows when an invoke step replays', async () => {
      const childWorkflow = workflow('invoke-child-idempotent', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('invoke-parent-idempotent', async ({ step }) => {
        return await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-idempotent',
          input: {},
        });
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-idempotent',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await testBoss.send(WORKFLOW_RUN_QUEUE_NAME, {
        runId: parentRun.id,
        resourceId,
        workflowId: 'invoke-parent-idempotent',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const childRuns = await engine.getRuns({ resourceId, workflowId: 'invoke-child-idempotent' });
      expect(childRuns.items).toHaveLength(1);
      expect(childRuns.items[0].idempotencyKey).toBeNull();
    });

    it('should return invokeChildWorkflow output cached after acquiring the parent lock', async () => {
      const now = new Date();
      const parentRun: WorkflowRun = {
        id: 'invoke-parent-lock-race',
        createdAt: now,
        updatedAt: now,
        resourceId,
        workflowId: 'invoke-parent-lock-race',
        status: WorkflowStatus.RUNNING,
        input: {},
        output: null,
        error: null,
        currentStepId: 'call-child',
        timeline: {},
        pausedAt: null,
        resumedAt: null,
        completedAt: null,
        timeoutAt: null,
        retryCount: 0,
        maxRetries: 0,
        jobId: null,
        idempotencyKey: null,
        parentRunId: null,
        parentStepId: null,
        parentResourceId: null,
      };
      const lockedParentRun: WorkflowRun = {
        ...parentRun,
        timeline: {
          'call-child': {
            output: { ok: true },
            timestamp: now,
          },
        },
      };
      const engineWithInvokeChildWorkflowStep = engine as unknown as {
        invokeChildWorkflowStep(args: {
          run: WorkflowRun;
          stepId: string;
          workflowId: string;
          input: unknown;
        }): Promise<unknown>;
      };
      const getRunSpy = vi.spyOn(engine, 'getRun').mockImplementation(async (_params, options) => {
        return options?.exclusiveLock ? lockedParentRun : parentRun;
      });

      try {
        await expect(
          engineWithInvokeChildWorkflowStep.invokeChildWorkflowStep({
            run: parentRun,
            stepId: 'call-child',
            workflowId: 'invoke-child-lock-race',
            input: {},
          }),
        ).resolves.toEqual({ ok: true });
      } finally {
        getRunSpy.mockRestore();
      }
    });

    it('should look up an existing invoked child using its original resource id', async () => {
      const now = new Date();
      const parentRun: WorkflowRun = {
        id: 'invoke-parent-child-resource-replay',
        createdAt: now,
        updatedAt: now,
        resourceId,
        workflowId: 'invoke-parent-child-resource-replay',
        status: WorkflowStatus.RUNNING,
        input: {},
        output: null,
        error: null,
        currentStepId: 'call-child',
        timeline: {},
        pausedAt: null,
        resumedAt: null,
        completedAt: null,
        timeoutAt: null,
        retryCount: 0,
        maxRetries: 0,
        jobId: null,
        idempotencyKey: null,
        parentRunId: null,
        parentStepId: null,
        parentResourceId: null,
      };
      const childRun: WorkflowRun = {
        id: 'invoke-child-resource-replay-run',
        createdAt: now,
        updatedAt: now,
        resourceId: 'original-child-resource',
        workflowId: 'invoke-child-resource-replay',
        status: WorkflowStatus.COMPLETED,
        input: {},
        output: { ok: true },
        error: null,
        currentStepId: '',
        timeline: {},
        pausedAt: null,
        resumedAt: null,
        completedAt: now,
        timeoutAt: null,
        retryCount: 0,
        maxRetries: 0,
        jobId: null,
        idempotencyKey: null,
        parentRunId: parentRun.id,
        parentStepId: 'call-child',
        parentResourceId: resourceId,
      };
      const lockedParentRun: WorkflowRun = {
        ...parentRun,
        timeline: {
          'call-child-invoke-child-workflow': {
            invokeChildWorkflow: {
              childRunId: childRun.id,
              childWorkflowId: childRun.workflowId,
              childResourceId: childRun.resourceId,
            },
            timestamp: now,
          },
        },
      };
      const engineWithInvokeChildWorkflowStep = engine as unknown as {
        invokeChildWorkflowStep(args: {
          run: WorkflowRun;
          stepId: string;
          workflowId: string;
          input: unknown;
          resourceId?: string;
        }): Promise<unknown>;
      };
      let observedChildLookup = false;
      const getRunSpy = vi.spyOn(engine, 'getRun').mockImplementation(async (params, options) => {
        if (options?.exclusiveLock) {
          return lockedParentRun;
        }

        expect(params).toEqual({
          runId: childRun.id,
          resourceId: childRun.resourceId,
        });
        observedChildLookup = true;
        return childRun;
      });
      const updateRunSpy = vi.spyOn(engine, 'updateRun').mockResolvedValue(lockedParentRun);

      try {
        await expect(
          engineWithInvokeChildWorkflowStep.invokeChildWorkflowStep({
            run: parentRun,
            stepId: 'call-child',
            workflowId: childRun.workflowId,
            input: {},
            resourceId: 'changed-child-resource',
          }),
        ).resolves.toEqual({ ok: true });
        expect(observedChildLookup).toBe(true);
      } finally {
        getRunSpy.mockRestore();
        updateRunSpy.mockRestore();
      }
    });

    it('should fail instead of linking an explicit invoke idempotency key to an unrelated run', async () => {
      const childWorkflow = workflow('invoke-child-key-conflict', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('invoke-parent-key-conflict', async ({ step }) => {
        await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-key-conflict',
          input: {},
          idempotencyKey: 'invoke-child-conflict-key',
        });
        return { unreachable: true };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const unrelatedChild = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-child-key-conflict',
        input: {},
        idempotencyKey: 'invoke-child-conflict-key',
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: unrelatedChild.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-key-conflict',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10_000,
        })
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: expect.stringContaining('does not belong to invokeChildWorkflow step'),
        });
    });

    it('should roll back the entire invoke txn when child enqueue fails and recreate a fresh child on retry', async () => {
      const childWorkflow = workflow('invoke-child-enqueue-retry', async ({ step }) => {
        return await step.run('child-step', async () => ({ ok: true }));
      });

      const parentWorkflow = workflow('invoke-parent-enqueue-retry', async ({ step }) => {
        return await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-enqueue-retry',
          input: {},
        });
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const originalSend = testBoss.send.bind(testBoss);
      let rejectedChildEnqueue = false;
      let childEnqueueAttempts = 0;
      const sendSpy = vi
        .spyOn(testBoss, 'send')
        .mockImplementation(async (queue, data, options) => {
          const job = data as { workflowId?: string };
          if (
            queue === WORKFLOW_RUN_QUEUE_NAME &&
            job.workflowId === 'invoke-child-enqueue-retry'
          ) {
            childEnqueueAttempts++;
            if (!rejectedChildEnqueue) {
              rejectedChildEnqueue = true;
              throw new Error('simulated child enqueue failure');
            }
          }

          return await originalSend(queue, data, options);
        });

      try {
        const parentRun = await engine.startWorkflow({
          resourceId,
          workflowId: 'invoke-parent-enqueue-retry',
          input: {},
          options: { retries: 1 },
        });

        await expect
          .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
            timeout: 15_000,
          })
          .toMatchObject({
            status: WorkflowStatus.COMPLETED,
            output: { ok: true },
          });

        expect(rejectedChildEnqueue).toBe(true);
        // First attempt's enqueue throws inside the parent-pause txn, rolling
        // back both the child INSERT and the parent pause. The retry then
        // creates a fresh child and enqueues it successfully — so exactly one
        // committed child run remains.
        expect(childEnqueueAttempts).toBe(2);
        const childRuns = await engine.getRuns({
          resourceId,
          workflowId: 'invoke-child-enqueue-retry',
        });
        expect(childRuns.items).toHaveLength(1);
      } finally {
        sendSpy.mockRestore();
      }
    });

    it('should fail the parent when an invoked child workflow fails', async () => {
      const childWorkflow = workflow('invoke-child-fails', async ({ step }) => {
        await step.run('fail', async () => {
          throw new Error('child exploded');
        });
      });

      const parentWorkflow = workflow('invoke-parent-child-fails', async ({ step }) => {
        await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-fails',
          input: {},
        });
        return { unreachable: true };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-child-fails',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10000,
        })
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: expect.stringContaining('child exploded'),
        });
      const failedParent = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(failedParent.timeline).not.toHaveProperty('call-child.output');
    });

    it('should fail the parent when an invoked child workflow is cancelled', async () => {
      const childWorkflow = workflow('invoke-child-cancelled', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('invoke-parent-child-cancelled', async ({ step }) => {
        await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-cancelled',
          input: {},
        });
        return { unreachable: true };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-child-cancelled',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const childRuns = await engine.getRuns({ resourceId, workflowId: 'invoke-child-cancelled' });
      expect(childRuns.items).toHaveLength(1);

      await engine.cancelWorkflow({ runId: childRuns.items[0].id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10000,
        })
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: expect.stringContaining('cancelled'),
        });
      const failedParent = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(failedParent.timeline).not.toHaveProperty('call-child.output');
    });

    it('should ignore fastForwardWorkflow on invokeChildWorkflow waits and only resume via the real child completion', async () => {
      const childWorkflow = workflow('invoke-child-ff-after-complete', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('invoke-parent-ff-after-complete', async ({ step }) => {
        return await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-ff-after-complete',
          input: {},
        });
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-ff-after-complete',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const childRuns = await engine.getRuns({
        resourceId,
        workflowId: 'invoke-child-ff-after-complete',
      });
      expect(childRuns.items).toHaveLength(1);
      const childRun = childRuns.items[0];

      // Calling fastForwardWorkflow on an invokeChildWorkflow wait must always be a
      // no-op; only the real invoke-completion event drives the parent forward.
      const ffWhilePending = await engine.fastForwardWorkflow({
        runId: parentRun.id,
        resourceId,
        data: { fake: true },
      });
      expect(ffWhilePending.status).toBe(WorkflowStatus.PAUSED);

      await engine.triggerEvent({
        runId: childRun.id,
        resourceId,
        eventName: 'child-ready',
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10_000,
        })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { ok: true },
        });
    });

    it('should fail the parent when its timeout fires while the child is still running', async () => {
      const childWorkflow = workflow('invoke-child-parent-timeout', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('invoke-parent-parent-timeout', async ({ step }) => {
        return await step.invokeChildWorkflow('call-child', {
          workflowId: 'invoke-child-parent-timeout',
          input: {},
        });
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-parent-timeout',
        input: {},
        // Short parent timeout so the parent times out while the child is
        // still waiting for `child-ready`.
        options: { timeout: 200 },
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      // Simulate the parent timeout firing: cancel the parent, which is the
      // engine's terminal "give up" path. Children are intentionally not
      // cancelled (documented behaviour) - the child should remain in PAUSED
      // and the parent's wakeup event should be dropped.
      await engine.cancelWorkflow({ runId: parentRun.id, resourceId });

      const parentAfterCancel = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(parentAfterCancel.status).toBe(WorkflowStatus.CANCELLED);

      const childRuns = await engine.getRuns({
        resourceId,
        workflowId: 'invoke-child-parent-timeout',
      });
      expect(childRuns.items).toHaveLength(1);
      const childBefore = childRuns.items[0];
      expect(childBefore.status).toBe(WorkflowStatus.PAUSED);

      // Completing the child must NOT revive the parent.
      await engine.triggerEvent({
        runId: childBefore.id,
        resourceId,
        eventName: 'child-ready',
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: childBefore.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const parentFinal = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(parentFinal.status).toBe(WorkflowStatus.CANCELLED);
    });

    it('should ignore a duplicate invoke-completion event after the parent has completed', async () => {
      const childWorkflow = workflow('invoke-child-duplicate-wakeup', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { value: 'done' };
      });

      const parentWorkflow = workflow('invoke-parent-duplicate-wakeup', async ({ step }) => {
        const childOutput = await step.invokeChildWorkflow<{ value: string }>('call-child', {
          workflowId: 'invoke-child-duplicate-wakeup',
          input: {},
        });
        return { childOutput };
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'invoke-parent-duplicate-wakeup',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const childRuns = await engine.getRuns({
        resourceId,
        workflowId: 'invoke-child-duplicate-wakeup',
      });
      expect(childRuns.items).toHaveLength(1);
      const childRun = childRuns.items[0];

      // First, let the child complete via the engine's own notify path so the
      // parent ends up COMPLETED with the real child output.
      await engine.triggerEvent({
        runId: childRun.id,
        resourceId,
        eventName: 'child-ready',
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10_000,
        })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { childOutput: { value: 'done' } },
        });

      // Now redeliver the same wakeup with a different payload. The parent is
      // already terminal, so the worker must see status !== PAUSED, skip the
      // wait-for unlock branch, fall through to the (now no-op) handler path,
      // and never overwrite the cached output. This guards the
      // "child notify fires twice (catch + DLQ)" deduplication path.
      const eventName = `__invoke_child_workflow_completed:${childRun.id}`;
      await testBoss.send(WORKFLOW_RUN_QUEUE_NAME, {
        runId: parentRun.id,
        resourceId,
        workflowId: 'invoke-parent-duplicate-wakeup',
        input: {},
        event: { name: eventName, data: { value: 'should-be-ignored' } },
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const finalParent = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(finalParent.status).toBe(WorkflowStatus.COMPLETED);
      expect(finalParent.output).toEqual({ childOutput: { value: 'done' } });
    });

    it('should handle workflow with pause step', async () => {
      const pausedWorkflow = workflow('paused-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.pause('step-2');
        return 'completed';
      });

      await engine.registerWorkflow(pausedWorkflow);
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'paused-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await engine.resumeWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'completed',
        });
    });

    it('should accumulate timeline entries across multiple sequential steps', async () => {
      const multiStepWorkflow = workflow('multi-step-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.run('step-2', async () => ({ nested: 'value' }));
        await step.run('step-3', async () => 42);
        return 'done';
      });

      await engine.registerWorkflow(multiStepWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'multi-step-workflow',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
          timeline: {
            'step-1': { output: 'result-1' },
            'step-2': { output: { nested: 'value' } },
            'step-3': { output: 42 },
          },
        });

      const completedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(Object.keys(completedRun.timeline)).toHaveLength(3);
    });

    it('should expose completed step outputs via context.timeline mid-handler', async () => {
      const observed: Record<string, Record<string, unknown>> = {};

      const timelineReadWorkflow = workflow('timeline-read-workflow', async (context) => {
        const { step } = context;
        observed.beforeStep1 = { ...context.timeline };
        await step.run('step-1', async () => 'result-1');
        observed.afterStep1 = { ...context.timeline };
        await step.run('step-2', async () => ({ nested: 'value' }));
        observed.afterStep2 = { ...context.timeline };
        return 'done';
      });

      await engine.registerWorkflow(timelineReadWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'timeline-read-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.COMPLETED);

      expect(observed.beforeStep1).toEqual({});
      expect(observed.afterStep1).toMatchObject({
        'step-1': { output: 'result-1' },
      });
      expect(observed.afterStep2).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2': { output: { nested: 'value' } },
      });
    });

    it('should preserve timeline entries from before pause through resume', async () => {
      const pauseTimelineWorkflow = workflow('pause-timeline-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'before-pause');
        await step.pause('step-2');
        await step.run('step-3', async () => 'after-pause');
        return 'done';
      });

      await engine.registerWorkflow(pauseTimelineWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'pause-timeline-workflow',
        input: {},
      });

      // Wait for the workflow to pause
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      // While paused, step-1 and the wait-for entry should be present
      const pausedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(pausedRun.timeline).toMatchObject({
        'step-1': { output: 'before-pause' },
        'step-2-wait-for': {
          waitFor: { eventName: '__internal_pause' },
        },
      });

      await engine.resumeWorkflow({ runId: run.id, resourceId });

      // After resume and completion, all entries should be preserved
      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
          timeline: {
            'step-1': { output: 'before-pause' },
            'step-2-wait-for': {
              waitFor: { eventName: '__internal_pause' },
            },
            'step-2': { output: {} },
            'step-3': { output: 'after-pause' },
          },
        });

      const completedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(Object.keys(completedRun.timeline)).toHaveLength(4);
    });

    it('should preserve timeline entries across run, waitFor, and run steps', async () => {
      const mixedWorkflow = workflow('mixed-timeline-workflow', async ({ step }) => {
        await step.run('setup', async () => ({ initialized: true }));
        await step.waitFor('approval', { eventName: 'approved' });
        await step.run('finalize', async () => 'finalized');
        return 'all-done';
      });

      await engine.registerWorkflow(mixedWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'mixed-timeline-workflow',
        input: {},
      });

      // Wait for the workflow to pause on waitFor
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      // Verify timeline has the run entry and the wait-for entry
      const pausedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(pausedRun.timeline).toMatchObject({
        setup: { output: { initialized: true } },
        'approval-wait-for': {
          waitFor: { eventName: 'approved' },
        },
      });
      expect(Object.keys(pausedRun.timeline)).toHaveLength(2);

      // Trigger the event with payload
      await engine.triggerEvent({
        runId: run.id,
        resourceId,
        eventName: 'approved',
        data: { approvedBy: 'admin', level: 3 },
      });

      // After completion, all 4 timeline entries must be present
      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'all-done',
          timeline: {
            setup: { output: { initialized: true } },
            'approval-wait-for': {
              waitFor: { eventName: 'approved' },
            },
            approval: { output: { approvedBy: 'admin', level: 3 } },
            finalize: { output: 'finalized' },
          },
        });

      const completedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(Object.keys(completedRun.timeline)).toHaveLength(4);
    });

    it('should should mark workflows with error as failed', async () => {
      const errorRetryWorkflow = workflow('error-workflow', async ({ step }) => {
        await step.run('step-1', async () => {
          throw new Error('Boom!');
        });
      });

      await engine.registerWorkflow(errorRetryWorkflow);
      const run = await engine.startWorkflow({
        resourceId: 'testResourceId',
        workflowId: 'error-workflow',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: 'Boom!',
        });

      expect(await engine.checkProgress({ runId: run.id, resourceId })).toMatchObject({
        completionPercentage: 0,
        totalSteps: 1,
        completedSteps: 0,
      });
    });

    it('should mark workflow run as failed when workflow is unregistered before worker processes it', async () => {
      const ephemeralWorkflow = workflow('ephemeral-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'done');
      });

      await engine.registerWorkflow(ephemeralWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ephemeral-workflow',
        input: {},
      });

      // Unregister before worker picks up the job
      await engine.unregisterWorkflow('ephemeral-workflow');

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), {
          timeout: 5000,
        })
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: expect.stringContaining('Workflow ephemeral-workflow not found'),
        });
    });

    it('should handle workflow with error and retry', async () => {
      let attemptCount = 0;
      const errorRetryWorkflow = workflow('error-retry-workflow', async ({ step }) => {
        await step.run('step-1', async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Boom!');
          }
          return 'success';
        });
        return 'completed';
      });

      await engine.registerWorkflow(errorRetryWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'error-retry-workflow',
        input: {
          data: 'test',
        },
        options: {
          retries: 3,
        },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), {
          timeout: 10000,
        })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'completed',
          timeline: {
            'step-1': {
              output: 'success',
            },
          },
        });
    });

    it('should not re-execute completed steps when a later step fails and retries', async () => {
      // Durability promise: on retry, step.run reads cached results from the
      // timeline and skips the handler. If step-1 has side effects (e.g. a
      // payment), it MUST run exactly once even if step-2 fails repeatedly.
      let stepOneRuns = 0;
      let stepTwoRuns = 0;
      const cachingWorkflow = workflow(
        'retry-caching-workflow',
        async ({ step }) => {
          const first = await step.run('step-1', async () => {
            stepOneRuns++;
            return { value: 'first' };
          });
          const second = await step.run('step-2', async () => {
            stepTwoRuns++;
            if (stepTwoRuns < 3) {
              throw new Error(`step-2 boom #${stepTwoRuns}`);
            }
            return { value: `${first.value}+second` };
          });
          return second;
        },
        { retries: 5 },
      );

      await engine.registerWorkflow(cachingWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'retry-caching-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      expect(stepOneRuns).toBe(1);
      expect(stepTwoRuns).toBe(3);

      const finished = await engine.getRun({ runId: run.id, resourceId });
      expect(finished.output).toEqual({ value: 'first+second' });
    });

    it('should delegate retries to pg-boss with exponential backoff', async () => {
      const failingWorkflow = workflow('backoff-workflow', async ({ step }) => {
        await step.run('step-1', async () => {
          throw new Error('always fails');
        });
      });

      await engine.registerWorkflow(failingWorkflow);

      const sendSpy = vi.spyOn(testBoss, 'send');

      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'backoff-workflow',
        input: {},
        options: { retries: 2 },
      });

      // pg-boss handles retries internally, so only ONE boss.send call is
      // made — the retry options on it tell pg-boss to retry up to 2 times
      // with exponential backoff.
      type JobData = { runId: string; workflowId: string };
      const sentCalls = sendSpy.mock.calls.filter(
        ([queue, data]) =>
          queue === WORKFLOW_RUN_QUEUE_NAME &&
          (data as JobData).runId === run.id &&
          (data as JobData).workflowId === 'backoff-workflow',
      );
      expect(sentCalls.length).toBe(1);
      const opts = sentCalls[0][2] as {
        retryLimit?: number;
        retryBackoff?: boolean;
        retryDelay?: number;
      };
      expect(opts.retryLimit).toBe(2);
      expect(opts.retryBackoff).toBe(true);
      expect(opts.retryDelay).toBe(1);

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10000,
        })
        .toBe(WorkflowStatus.FAILED);

      const finalRun = await engine.getRun({ runId: run.id, resourceId });
      expect(finalRun.retryCount).toBe(2);
      expect(finalRun.error).toBe('always fails');

      sendSpy.mockRestore();
    });

    describe('dead-letter recovery for stuck runs', () => {
      const insertStuckRun = async ({
        workflowId,
        retryCount,
        maxRetries,
        status,
      }: {
        workflowId: string;
        retryCount: number;
        maxRetries: number;
        status: WorkflowStatus;
      }) => {
        const runId = `run_stuck_${Math.random().toString(36).slice(2, 10)}`;
        const now = new Date();
        await testPool.query(
          `INSERT INTO workflow_runs (
            id, resource_id, workflow_id, current_step_id, status, input,
            max_retries, retry_count, timeline, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            runId,
            resourceId,
            workflowId,
            'step-1',
            status,
            JSON.stringify({ data: 'stuck' }),
            maxRetries,
            retryCount,
            '{}',
            now,
            now,
          ],
        );
        return runId;
      };

      it('should mark a stuck RUNNING run as FAILED when DLQ fires', async () => {
        const runId = await insertStuckRun({
          workflowId: 'test-workflow',
          retryCount: 2,
          maxRetries: 2,
          status: WorkflowStatus.RUNNING,
        });

        await testBoss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, { runId });

        await expect
          .poll(async () => (await engine.getRun({ runId, resourceId })).status, {
            timeout: 5000,
          })
          .toBe(WorkflowStatus.FAILED);

        const failed = await engine.getRun({ runId, resourceId });
        expect(failed.error).toContain('worker died');
      });

      it('should ignore DLQ jobs that need no recovery and stay alive', async () => {
        // Three no-op cases the DLQ worker must skip without crashing:
        // (1) terminal status, (2) missing runId, (3) unknown runId.
        // A bad payload that crashes the worker would poison the pipeline.
        const completedRunId = await insertStuckRun({
          workflowId: 'test-workflow',
          retryCount: 0,
          maxRetries: 2,
          status: WorkflowStatus.COMPLETED,
        });
        await testBoss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, { runId: completedRunId });
        await testBoss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, {});
        await testBoss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, { runId: 'run_does_not_exist_xyz' });

        // A follow-up valid DLQ message proves the worker stayed alive past
        // all three no-ops once it advances the live run to FAILED.
        const liveRunId = await insertStuckRun({
          workflowId: 'test-workflow',
          retryCount: 2,
          maxRetries: 2,
          status: WorkflowStatus.RUNNING,
        });
        await testBoss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, { runId: liveRunId });

        await expect
          .poll(async () => (await engine.getRun({ runId: liveRunId, resourceId })).status, {
            timeout: 10000,
          })
          .toBe(WorkflowStatus.FAILED);

        const completed = await engine.getRun({ runId: completedRunId, resourceId });
        expect(completed.status).toBe(WorkflowStatus.COMPLETED);
        expect(completed.retryCount).toBe(0);
      });
    });

    it('should handle workflow with waitUntil step', async () => {
      const waitUntilWorkflow = workflow('wait-until-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.waitUntil('step-2', { date: new Date(Date.now() + 500) });
        await step.run('step-3', async () => 'result-3');
        return 'completed';
      });

      await engine.registerWorkflow(waitUntilWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'wait-until-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const pausedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(pausedRun.timeline).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2-wait-for': {
          waitFor: { timeoutEvent: '__timeout_step-2' },
        },
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toBe('completed');
      expect(completed.timeline).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2-wait-for': {
          waitFor: { timeoutEvent: '__timeout_step-2' },
        },
        'step-2': { output: { date: expect.any(String) } },
        'step-3': { output: 'result-3' },
      });
    });

    it('should execute waitUntil immediately when date is in the past', async () => {
      const pastDateWorkflow = workflow('wait-until-past-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.waitUntil('step-2', new Date(Date.now() - 1000));
        await step.run('step-3', async () => 'result-3');
        return 'completed';
      });

      await engine.registerWorkflow(pastDateWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'wait-until-past-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toBe('completed');
      expect(completed.timeline).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2': { output: { date: expect.any(String) } },
        'step-3': { output: 'result-3' },
      });
    });

    it('should handle workflow with delay step (string duration)', async () => {
      const delayWorkflow = workflow('delay-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.delay('step-2', '500ms');
        await step.run('step-3', async () => 'result-3');
        return 'completed';
      });

      await engine.registerWorkflow(delayWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'delay-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toBe('completed');
      expect(completed.timeline).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2': { output: { date: expect.any(String) } },
        'step-3': { output: 'result-3' },
      });
    });

    it('should handle workflow with delay step (object duration)', async () => {
      const delayWorkflow = workflow('delay-object-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.delay('step-2', { seconds: 1 });
        await step.run('step-3', async () => 'result-3');
        return 'completed';
      });

      await engine.registerWorkflow(delayWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'delay-object-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toBe('completed');
    });

    it('should treat sleep as alias of delay', async () => {
      const sleepWorkflow = workflow('sleep-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        await step.sleep('step-2', '500ms');
        await step.run('step-3', async () => 'result-3');
        return 'completed';
      });

      await engine.registerWorkflow(sleepWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'sleep-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toBe('completed');
      expect(completed.timeline).toMatchObject({
        'step-1': { output: 'result-1' },
        'step-2': { output: { date: expect.any(String) } },
        'step-3': { output: 'result-3' },
      });
    });

    it('should resolve waitFor with undefined when timeout fires before event', async () => {
      const waitForTimeoutWorkflow = workflow('wait-for-timeout-workflow', async ({ step }) => {
        await step.run('step-1', async () => 'result-1');
        const result = await step.waitFor('step-2', {
          eventName: 'some-event',
          timeout: 500,
        });
        return { result };
      });

      await engine.registerWorkflow(waitForTimeoutWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'wait-for-timeout-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const pausedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(pausedRun.timeline).toMatchObject({
        'step-2-wait-for': {
          waitFor: { eventName: 'some-event', timeoutEvent: '__timeout_step-2' },
        },
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 5000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      const completed = await engine.getRun({ runId: run.id, resourceId });
      expect(completed.output).toEqual({ result: undefined });
    });

    it('should resolve waitFor with event data when event fires before timeout', async () => {
      const waitForBeforeTimeoutWorkflow = workflow(
        'wait-for-before-timeout-workflow',
        async ({ step }) => {
          const result = await step.waitFor('step-1', {
            eventName: 'early-event',
            timeout: 5000,
          });
          return { result };
        },
      );

      await engine.registerWorkflow(waitForBeforeTimeoutWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'wait-for-before-timeout-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      await engine.triggerEvent({
        runId: run.id,
        resourceId,
        eventName: 'early-event',
        data: { fired: true },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 5000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { result: { fired: true } },
        });
    });

    it('should resolve poll step when condition becomes true', async () => {
      let callCount = 0;
      const pollConditionWorkflow = workflow('poll-condition-workflow', async ({ step }) => {
        const result = await step.poll(
          'poll-step',
          async () => {
            callCount++;
            return callCount >= 3 ? { value: callCount } : false;
          },
          { interval: '30s' },
        );
        return result;
      });

      await engine.registerWorkflow(pollConditionWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'poll-condition-workflow',
        input: {},
      });

      // First execution: condition false, workflow pauses
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      const pausedRun = await engine.getRun({ runId: run.id, resourceId });
      expect(pausedRun.timeline).toMatchObject({
        'poll-step-poll': { startedAt: expect.any(String) },
        'poll-step-wait-for': {
          waitFor: { timeoutEvent: '__poll_poll-step', skipOutput: true },
        },
      });

      // Manually trigger second poll (simulating interval firing)
      await engine.triggerEvent({ runId: run.id, resourceId, eventName: '__poll_poll-step' });

      // Second execution: condition still false, workflow pauses again
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      // Manually trigger third poll
      await engine.triggerEvent({ runId: run.id, resourceId, eventName: '__poll_poll-step' });

      // Third execution: condition true, workflow completes
      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 5000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { timedOut: false, data: { value: 3 } },
          timeline: {
            'poll-step': { output: { value: 3 } },
          },
        });
    });

    it('should resolve poll step with timedOut when timeout expires', async () => {
      const pollTimeoutWorkflow = workflow('poll-timeout-workflow', async ({ step }) => {
        const result = await step.poll('poll-step', async () => false, {
          interval: '30s',
          timeout: '1s',
        });
        return result;
      });

      await engine.registerWorkflow(pollTimeoutWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'poll-timeout-workflow',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status)
        .toBe(WorkflowStatus.PAUSED);

      // Wait for timeout to elapse then trigger a poll cycle
      await new Promise((r) => setTimeout(r, 1100));
      await engine.triggerEvent({ runId: run.id, resourceId, eventName: '__poll_poll-step' });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 5000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { timedOut: true },
          timeline: {
            'poll-step': { output: {}, timedOut: true },
          },
        });
    });

    it('should throw when poll interval is below 30s', async () => {
      const pollInvalidWorkflow = workflow('poll-invalid-workflow', async ({ step }) => {
        await step.poll('poll-step', async () => false, { interval: '1s' });
      });

      await engine.registerWorkflow(pollInvalidWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'poll-invalid-workflow',
        input: {},
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 5000 })
        .toMatchObject({
          status: WorkflowStatus.FAILED,
          error: expect.stringContaining('step.poll interval must be at least 30s'),
        });
    });

    it.todo('should handle workflow timeout', async () => {});

    it('should handle workflow with conditionals and for loops', async () => {
      const complexWorkflow = workflow(
        'complex-workflow',
        async ({ step, input }) => {
          const results: string[] = [];

          await step.run('start', async () => {
            results.push('started');
            return 'started';
          });

          // For loop with dynamic step IDs
          for (let i = 0; i < input.loopCount; i++) {
            await step.run(`loop-step-${i}`, async () => {
              results.push(`loop-${i}`);
              return `loop-result-${i}`;
            });
          }

          // Conditional steps
          if (input.shouldRunConditional) {
            await step.run('conditional-step', async () => {
              results.push('conditional');
              return 'conditional-result';
            });
          }

          // Nested conditional and loop
          if (input.shouldRunNested) {
            for (let j = 0; j < 2; j++) {
              await step.run(`nested-${j}`, async () => {
                results.push(`nested-${j}`);
                return `nested-result-${j}`;
              });
            }
          }

          await step.run('end', async () => {
            results.push('ended');
            return 'ended';
          });

          return { completed: true, results };
        },
        {
          inputSchema: v.object({
            loopCount: v.number(),
            shouldRunConditional: v.boolean(),
            shouldRunNested: v.boolean(),
          }),
        },
      );

      await engine.registerWorkflow(complexWorkflow);

      // Test with loop and conditionals enabled
      const run1 = await engine.startWorkflow({
        resourceId,
        workflowId: 'complex-workflow',
        input: {
          loopCount: 3,
          shouldRunConditional: true,
          shouldRunNested: true,
        },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run1.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: {
            completed: true,
            results: [
              'started',
              'loop-0',
              'loop-1',
              'loop-2',
              'conditional',
              'nested-0',
              'nested-1',
              'ended',
            ],
          },
        });

      // Test with conditionals disabled
      const run2 = await engine.startWorkflow({
        resourceId,
        workflowId: 'complex-workflow',
        input: {
          loopCount: 2,
          shouldRunConditional: false,
          shouldRunNested: false,
        },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run2.id, resourceId }))
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: {
            completed: true,
            results: ['started', 'loop-0', 'loop-1', 'ended'],
          },
        });
    });

    // TODO: This workflow syntax is not supported yet, but must be fixed
    it.skip('should handle workflow with early guards', async () => {
      const w = workflow('conditional-loop-workflow', async ({ step }) => {
        const result = await step.run('step-1', async () => {
          return 'step-1-result';
        });

        // Workflow should exit early here
        if (result === 'step-2-result') {
          return 'early-exit';
        }

        await step.run('step-2', async () => {
          return 'final-exit';
        });
      });

      await engine.registerWorkflow(w);

      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'conditional-loop-workflow',
        input: {},
      });

      const runResult = await engine.getRun({ runId: run.id, resourceId });
      expect(runResult).toMatchObject({
        status: WorkflowStatus.COMPLETED,
        output: 'final-exit',
      });
    });
  });

  describe('getRun() and getRuns()', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start(false);
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('getRun should throw WorkflowRunNotFoundError when run is missing', async () => {
      await expect(engine.getRun({ runId: 'run_nonexistent', resourceId })).rejects.toBeInstanceOf(
        WorkflowRunNotFoundError,
      );

      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'test-workflow',
        input: { data: 'test' },
      });
      expect(run.id).toBeDefined();

      await expect(
        engine.getRun({ runId: run.id, resourceId: 'wrong_resourceId' }),
      ).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
    });

    it('getRuns should return paginated results scoped by resourceId', async () => {
      const runA1 = await engine.startWorkflow({
        resourceId: 'userA',
        workflowId: 'test-workflow',
        input: { data: 'a1' },
      });
      await new Promise((r) => setTimeout(r, 5));
      const runA2 = await engine.startWorkflow({
        resourceId: 'userA',
        workflowId: 'test-workflow',
        input: { data: 'a2' },
      });
      await new Promise((r) => setTimeout(r, 5));
      const runA3 = await engine.startWorkflow({
        resourceId: 'userA',
        workflowId: 'test-workflow',
        input: { data: 'a3' },
      });
      await new Promise((r) => setTimeout(r, 5));
      await engine.startWorkflow({
        resourceId: 'userB',
        workflowId: 'test-workflow',
        input: { data: 'b1' },
      });

      const page1 = await engine.getRuns({ resourceId: 'userA', limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect([runA3.id, runA2.id]).toContain(page1.items[0]?.id);
      expect([runA3.id, runA2.id]).toContain(page1.items[1]?.id);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(page1.items[1]?.id || null);
      expect(page1.hasPrev).toBe(false);

      const page2 = await engine.getRuns({
        resourceId: 'userA',
        limit: 2,
        startingAfter: page1.nextCursor,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).toBe(runA1.id);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
      expect(page2.hasPrev).toBe(true);

      const runningOnly = await engine.getRuns({
        resourceId: 'userA',
        limit: 10,
        statuses: [WorkflowStatus.RUNNING],
      });
      expect(runningOnly.items.length).toBeGreaterThanOrEqual(3);
      for (const r of runningOnly.items) {
        expect(r.status).toBe(WorkflowStatus.RUNNING);
      }
    });

    it('getRuns should navigate forward and backward across multiple pages', async () => {
      const PAGE_SIZE = 10;
      const TOTAL_RUNS = 35;
      const runIds: string[] = [];

      for (let i = 0; i < TOTAL_RUNS; i++) {
        const run = await engine.startWorkflow({
          resourceId: 'paginationUser',
          workflowId: 'test-workflow',
          input: { data: `run-${i}` },
        });
        runIds.push(run.id);
        await new Promise((r) => setTimeout(r, 2));
      }

      // runIds[0] is oldest, runIds[34] is newest.
      // Results are ordered newest-first (DESC), so:
      //   Page 1: runIds[34..25]  (10 items)
      //   Page 2: runIds[24..15]  (10 items)
      //   Page 3: runIds[14..5]   (10 items)
      //   Page 4: runIds[4..0]    (5 items)
      const expectedPage1Ids = runIds.slice(25, 35).reverse();
      const expectedPage2Ids = runIds.slice(15, 25).reverse();
      const expectedPage3Ids = runIds.slice(5, 15).reverse();
      const expectedPage4Ids = runIds.slice(0, 5).reverse();

      // --- Forward pagination ---

      // Page 1
      const page1 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
      });
      expect(page1.items).toHaveLength(10);
      expect(page1.items.map((r) => r.id)).toEqual(expectedPage1Ids);
      expect(page1.hasMore).toBe(true);
      expect(page1.hasPrev).toBe(false);
      expect(page1.nextCursor).toBe(expectedPage1Ids[9]);
      expect(page1.prevCursor).toBeNull();

      // Page 2
      const page2 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        startingAfter: page1.nextCursor,
      });
      expect(page2.items).toHaveLength(10);
      expect(page2.items.map((r) => r.id)).toEqual(expectedPage2Ids);
      expect(page2.hasMore).toBe(true);
      expect(page2.hasPrev).toBe(true);
      expect(page2.nextCursor).toBe(expectedPage2Ids[9]);
      expect(page2.prevCursor).toBe(expectedPage2Ids[0]);

      // Page 3
      const page3 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        startingAfter: page2.nextCursor,
      });
      expect(page3.items).toHaveLength(10);
      expect(page3.items.map((r) => r.id)).toEqual(expectedPage3Ids);
      expect(page3.hasMore).toBe(true);
      expect(page3.hasPrev).toBe(true);
      expect(page3.nextCursor).toBe(expectedPage3Ids[9]);

      // Page 4 (last page, partial)
      const page4 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        startingAfter: page3.nextCursor,
      });
      expect(page4.items).toHaveLength(5);
      expect(page4.items.map((r) => r.id)).toEqual(expectedPage4Ids);
      expect(page4.hasMore).toBe(false);
      expect(page4.hasPrev).toBe(true);
      expect(page4.nextCursor).toBeNull();

      // --- Backward pagination ---

      // Back to page 3 (endingBefore = first item of page 4)
      const backPage3 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        endingBefore: page4.items[0]?.id,
      });
      expect(backPage3.items).toHaveLength(10);
      expect(backPage3.items.map((r) => r.id)).toEqual(expectedPage3Ids);
      expect(backPage3.hasMore).toBe(true);
      expect(backPage3.hasPrev).toBe(true);
      expect(backPage3.nextCursor).toBe(expectedPage3Ids[9]);
      expect(backPage3.prevCursor).toBe(expectedPage3Ids[0]);

      // Back to page 2 (endingBefore = first item of page 3)
      const backPage2 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        endingBefore: backPage3.items[0]?.id,
      });
      expect(backPage2.items).toHaveLength(10);
      expect(backPage2.items.map((r) => r.id)).toEqual(expectedPage2Ids);
      expect(backPage2.hasMore).toBe(true);
      expect(backPage2.hasPrev).toBe(true);
      expect(backPage2.nextCursor).toBe(expectedPage2Ids[9]);
      expect(backPage2.prevCursor).toBe(expectedPage2Ids[0]);

      // Back to page 1 (endingBefore = first item of page 2)
      const backPage1 = await engine.getRuns({
        resourceId: 'paginationUser',
        limit: PAGE_SIZE,
        endingBefore: backPage2.items[0]?.id,
      });
      expect(backPage1.items).toHaveLength(10);
      expect(backPage1.items.map((r) => r.id)).toEqual(expectedPage1Ids);
      expect(backPage1.hasMore).toBe(true);
      expect(backPage1.hasPrev).toBe(false);
      expect(backPage1.nextCursor).toBe(expectedPage1Ids[9]);
      expect(backPage1.prevCursor).toBeNull();
    });
  });

  describe('fastForwardWorkflow', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
        pool: testPool,
        boss: testBoss,
      });
      await engine.start();
    });

    afterEach(async () => {
      await engine.stop();
    });

    it('should fast-forward a waitFor step with provided data', async () => {
      const ffWorkflow = workflow('ff-method-waitfor', async ({ step }) => {
        await step.run('step-1', async () => 'before');
        const eventData = await step.waitFor('wait-step', { eventName: 'approval' });
        await step.run('step-2', async () => ({ prev: eventData }));
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-waitfor',
        input: {},
      });

      // Wait for workflow to pause at waitFor step
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      // Fast-forward with mock data
      await engine.fastForwardWorkflow({
        runId: run.id,
        resourceId,
        data: { approved: true },
      });

      // Workflow should complete with the mock data flowing through
      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
          timeline: {
            'wait-step': { output: { approved: true } },
            'step-2': { output: { prev: { approved: true } } },
          },
        });
    });

    it('should fast-forward a delay step', async () => {
      const ffWorkflow = workflow('ff-method-delay', async ({ step }) => {
        await step.run('step-1', async () => 'before');
        await step.delay('wait-step', '1h');
        await step.run('step-2', async () => 'after');
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-delay',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      await engine.fastForwardWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
        });
    });

    it('should fast-forward a waitUntil step', async () => {
      const ffWorkflow = workflow('ff-method-waituntil', async ({ step }) => {
        await step.run('step-1', async () => 'before');
        await step.waitUntil('wait-step', new Date(Date.now() + 3_600_000));
        await step.run('step-2', async () => 'after');
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-waituntil',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      await engine.fastForwardWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
        });
    });

    it('should fast-forward a poll step with mock data', async () => {
      const ffWorkflow = workflow('ff-method-poll', async ({ step }) => {
        const result = await step.poll(
          'poll-step',
          async () => {
            return false;
          },
          { interval: '30s' },
        );
        return result;
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-poll',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      await engine.fastForwardWorkflow({
        runId: run.id,
        resourceId,
        data: { value: 42 },
      });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { timedOut: false, data: { value: 42 } },
          timeline: {
            'poll-step': { output: { value: 42 } },
          },
        });
    });

    it('should resume a step.pause() step', async () => {
      const ffWorkflow = workflow('ff-method-pause', async ({ step }) => {
        await step.run('step-1', async () => 'before');
        await step.pause('manual-pause');
        await step.run('step-2', async () => 'after');
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-pause',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      await engine.fastForwardWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: 'done',
        });
    });

    it('should not fast-forward an invokeChildWorkflow step while the child is still running', async () => {
      const childWorkflow = workflow('ff-method-invoke-child', async ({ step }) => {
        await step.waitFor('child-wait', { eventName: 'child-ready' });
        return { ok: true };
      });

      const parentWorkflow = workflow('ff-method-invoke-parent', async ({ step }) => {
        return await step.invokeChildWorkflow('call-child', {
          workflowId: 'ff-method-invoke-child',
          input: {},
        });
      });

      await engine.registerWorkflow(childWorkflow);
      await engine.registerWorkflow(parentWorkflow);

      const parentRun = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-invoke-parent',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: parentRun.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      await engine.fastForwardWorkflow({
        runId: parentRun.id,
        resourceId,
        data: { fake: true },
      });

      const stillPaused = await engine.getRun({ runId: parentRun.id, resourceId });
      expect(stillPaused.status).toBe(WorkflowStatus.PAUSED);
      expect(stillPaused.timeline).not.toHaveProperty('call-child.output');

      const childRuns = await engine.getRuns({ resourceId, workflowId: 'ff-method-invoke-child' });
      expect(childRuns.items).toHaveLength(1);

      await engine.triggerEvent({
        runId: childRuns.items[0].id,
        resourceId,
        eventName: 'child-ready',
      });

      await expect
        .poll(async () => await engine.getRun({ runId: parentRun.id, resourceId }), {
          timeout: 10_000,
        })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          output: { ok: true },
        });
    });

    it('should noop when workflow is not paused', async () => {
      const ffWorkflow = workflow('ff-method-noop', async ({ step }) => {
        await step.run('step-1', async () => 'result');
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-noop',
        input: {},
      });

      // Wait for completion
      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.COMPLETED);

      // Calling fastForward on a completed workflow should noop
      const result = await engine.fastForwardWorkflow({ runId: run.id, resourceId });
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should default data to {} when not provided', async () => {
      const ffWorkflow = workflow('ff-method-default-data', async ({ step }) => {
        await step.run('step-1', async () => 'before');
        const eventData = await step.waitFor('wait-step', { eventName: 'approval' });
        await step.run('step-2', async () => ({ prev: eventData }));
        return 'done';
      });

      await engine.registerWorkflow(ffWorkflow);
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'ff-method-default-data',
        input: {},
      });

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10_000,
        })
        .toBe(WorkflowStatus.PAUSED);

      // Call without data parameter
      await engine.fastForwardWorkflow({ runId: run.id, resourceId });

      await expect
        .poll(async () => await engine.getRun({ runId: run.id, resourceId }), { timeout: 10_000 })
        .toMatchObject({
          status: WorkflowStatus.COMPLETED,
          timeline: {
            'wait-step': { output: {} },
            'step-2': { output: { prev: {} } },
          },
        });
    });
  });
});
