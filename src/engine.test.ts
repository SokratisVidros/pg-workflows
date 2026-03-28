import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

    it('should use exponential backoff for retries', async () => {
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

      await expect
        .poll(async () => (await engine.getRun({ runId: run.id, resourceId })).status, {
          timeout: 10000,
        })
        .toBe(WorkflowStatus.FAILED);

      type JobData = { runId: string; workflowId: string };

      const retryCalls = sendSpy.mock.calls.filter(
        ([queue, data]) =>
          queue === 'workflow-run' &&
          (data as JobData).runId === run.id &&
          (data as JobData).workflowId === 'backoff-workflow',
      );

      // 1 initial send from startWorkflow + 2 retry sends
      expect(retryCalls.length).toBe(3);

      for (const [, , options] of retryCalls.slice(1)) {
        const opts = options as { startAfter?: Date; retryDelay?: number };
        expect(opts.startAfter).toBeInstanceOf(Date);
        expect(opts).not.toHaveProperty('retryDelay');
      }

      sendSpy.mockRestore();
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
      const complexWorkflow = workflow('complex-workflow', async ({ step, input }) => {
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
      });

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
