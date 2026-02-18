import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { workflow } from './definition';
import { WorkflowEngine } from './engine';
import { WorkflowEngineError, WorkflowRunNotFoundError } from './error';
import { getBoss } from './tests/pgboss';
import { closeTestDatabase, createTestDatabase } from './tests/test-db';
import { WorkflowStatus } from './types';

let testBoss: PgBoss;

beforeAll(async () => {
  const testDb = await createTestDatabase();
  testBoss = await getBoss(testDb);
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

  describe('unregisterWorkflow()', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
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
  });

  describe('resumeWorkflow(runId)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
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
  });

  describe('cancelWorkflow(runId)', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
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
  });

  describe('workflow execution', () => {
    let engine: WorkflowEngine;

    beforeEach(async () => {
      engine = new WorkflowEngine({
        workflows: [testWorkflow],
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
          waitFor: { eventName: '__wait_until_step-2' },
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
          waitFor: { eventName: '__wait_until_step-2' },
        },
        'step-2': { output: { date: expect.any(String) } },
        'step-3': { output: 'result-3' },
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
      expect(page2.hasPrev).toBe(false);

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
  });
});
