import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_PGBOSS_SCHEMA, WORKFLOW_RUN_DLQ_QUEUE_NAME } from './constants';
import { workflow } from './definition';
import { WorkflowEngine } from './engine';
import { WorkflowStatus } from './types';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pg_workflows_test';

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 30_000;

let pool: pg.Pool;
let engine: WorkflowEngine;

async function waitForStatus(
  runId: string,
  resourceId: string | undefined,
  targetStatuses: string[],
  timeoutMs = POLL_TIMEOUT_MS,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const progress =
      resourceId !== undefined
        ? await engine.checkProgress({ runId, resourceId })
        : await engine.checkProgress({ runId });
    if (targetStatuses.includes(progress.status)) {
      return progress;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const final =
    resourceId !== undefined
      ? await engine.checkProgress({ runId, resourceId })
      : await engine.checkProgress({ runId });
  throw new Error(
    `Timed out waiting for status [${targetStatuses}]. Current: ${final.status}, step: ${final.currentStepId}`,
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Workflow definitions ----

const sequentialWorkflow = workflow('integration-sequential', async ({ step }) => {
  const a = await step.run('step-1', async () => {
    await sleep(100);
    return { value: 'one' };
  });

  const b = await step.run('step-2', async () => {
    await sleep(100);
    return { value: 'two', prev: a.value };
  });

  const c = await step.run('step-3', async () => {
    await sleep(100);
    return { value: 'three', prev: b.value };
  });

  return { a, b, c };
});

const inputValidationWorkflow = workflow(
  'integration-input-validation',
  async ({ step, input }) => {
    const result = await step.run('process', async () => {
      const typed = input as { name: string; count: number };
      return { greeting: `Hello ${typed.name}`, doubled: typed.count * 2 };
    });
    return result;
  },
  {
    inputSchema: z.object({
      name: z.string(),
      count: z.number().int().positive(),
    }),
  },
);

const waitForEventWorkflow = workflow('integration-wait-for-event', async ({ step }) => {
  const setup = await step.run('setup', async () => {
    return { ready: true };
  });

  const eventData = await step.waitFor('wait-for-approval', {
    eventName: 'approval',
    timeout: 30_000,
  });

  const final = await step.run('finalize', async () => {
    return { setup, approved: (eventData as Record<string, unknown>)?.approved ?? false };
  });

  return final;
});

let retryAttempt = 0;
const retryWorkflow = workflow(
  'integration-retry',
  async ({ step }) => {
    const result = await step.run('flaky-step', async () => {
      retryAttempt++;
      if (retryAttempt < 3) {
        throw new Error(`Attempt ${retryAttempt} failed`);
      }
      return { attempt: retryAttempt };
    });
    return result;
  },
  { retries: 5 },
);

let cachedStepOneRuns = 0;
let cachedStepTwoRuns = 0;
const cachedRetryWorkflow = workflow(
  'integration-cached-retry',
  async ({ step }) => {
    const first = await step.run('charge', async () => {
      cachedStepOneRuns++;
      return { charged: true };
    });
    const second = await step.run('notify', async () => {
      cachedStepTwoRuns++;
      if (cachedStepTwoRuns < 3) {
        throw new Error(`notify boom #${cachedStepTwoRuns}`);
      }
      return { notified: true, prevCharged: first.charged };
    });
    return second;
  },
  { retries: 5 },
);

const pauseResumeWorkflow = workflow('integration-pause-resume', async ({ step }) => {
  const before = await step.run('before-pause', async () => {
    return { phase: 'before' };
  });

  await step.pause('manual-pause');

  const after = await step.run('after-pause', async () => {
    return { phase: 'after', prev: before.phase };
  });

  return { before, after };
});

const cancelWorkflow = workflow('integration-cancel', async ({ step }) => {
  await step.run('step-1', async () => {
    return { started: true };
  });

  await step.waitFor('wait-forever', {
    eventName: 'never-coming',
    timeout: 60_000,
  });

  await step.run('step-2', async () => {
    return { shouldNotRun: true };
  });
});

// ---- Test suite ----

describe('WorkflowEngine Integration (real PostgreSQL)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

    // Verify connection
    await pool.query('SELECT 1');

    engine = new WorkflowEngine({
      pool,
      workflows: [
        sequentialWorkflow,
        inputValidationWorkflow,
        waitForEventWorkflow,
        retryWorkflow,
        cachedRetryWorkflow,
        pauseResumeWorkflow,
        cancelWorkflow,
      ],
    });

    await engine.start(true, { batchSize: 1 });
  });

  afterAll(async () => {
    if (engine) {
      await engine.stop();
    }
    if (pool) {
      await pool.end();
    }
  });

  it('should complete a multi-step sequential workflow', async () => {
    const resourceId = `test-seq-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      resourceId,
      input: {},
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe(WorkflowStatus.RUNNING);

    const result = await waitForStatus(run.id, resourceId, ['completed']);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.completionPercentage).toBe(100);
    expect(result.completedSteps).toBe(3);
    expect(result.totalSteps).toBe(3);
    expect(result.output).toEqual({
      a: { value: 'one' },
      b: { value: 'two', prev: 'one' },
      c: { value: 'three', prev: 'two' },
    });
    expect(result.error).toBeNull();
  });

  it('should complete sequential workflow without resourceId', async () => {
    const run = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      input: {},
    });

    expect(run.resourceId).toBeNull();

    const result = await waitForStatus(run.id, undefined, ['completed']);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.completionPercentage).toBe(100);
  });

  it('should validate input with Zod schema', async () => {
    const resourceId = `test-input-${Date.now()}`;

    // Invalid input should throw
    await expect(
      engine.startWorkflow({
        workflowId: 'integration-input-validation',
        resourceId,
        input: { name: 123, count: 'not-a-number' },
      }),
    ).rejects.toThrow();

    // Valid input should succeed
    const run = await engine.startWorkflow({
      workflowId: 'integration-input-validation',
      resourceId: `${resourceId}-valid`,
      input: { name: 'World', count: 5 },
    });

    const result = await waitForStatus(run.id, `${resourceId}-valid`, ['completed']);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.output).toEqual({
      greeting: 'Hello World',
      doubled: 10,
    });
  });

  it('should pause for waitFor and resume on triggerEvent', async () => {
    const resourceId = `test-event-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-wait-for-event',
      resourceId,
      input: {},
    });

    // Wait until workflow pauses at the waitFor step
    const paused = await waitForStatus(run.id, resourceId, ['paused']);
    expect(paused.status).toBe(WorkflowStatus.PAUSED);
    expect(paused.currentStepId).toBe('wait-for-approval');

    // Send the event
    await engine.triggerEvent({
      runId: run.id,
      resourceId,
      eventName: 'approval',
      data: { approved: true, reviewer: 'integration-test' },
    });

    // Wait for completion
    const result = await waitForStatus(run.id, resourceId, ['completed']);
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.output).toEqual({
      setup: { ready: true },
      approved: true,
    });
  });

  it('should resume waitFor when triggerEvent omits resourceId', async () => {
    const resourceId = `test-event-no-res-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-wait-for-event',
      resourceId,
      input: {},
    });

    await waitForStatus(run.id, resourceId, ['paused']);

    await engine.triggerEvent({
      runId: run.id,
      eventName: 'approval',
      data: { approved: true },
    });

    const result = await waitForStatus(run.id, resourceId, ['completed']);
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.output).toEqual({
      setup: { ready: true },
      approved: true,
    });
  });

  it('should retry on failure and eventually succeed', async () => {
    retryAttempt = 0;

    const resourceId = `test-retry-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-retry',
      resourceId,
      input: {},
    });

    const result = await waitForStatus(run.id, resourceId, ['completed', 'failed']);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.output).toEqual({ attempt: 3 });
    expect(result.retryCount).toBeGreaterThanOrEqual(2);
  });

  it('should not re-execute completed steps when retries occur', async () => {
    // End-to-end durability proof: step 'charge' must run exactly once even
    // though step 'notify' fails twice. On retries, the engine reads the
    // 'charge' result from the timeline and skips its handler.
    cachedStepOneRuns = 0;
    cachedStepTwoRuns = 0;

    const resourceId = `test-cached-retry-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-cached-retry',
      resourceId,
      input: {},
    });

    const result = await waitForStatus(run.id, resourceId, ['completed', 'failed']);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(cachedStepOneRuns).toBe(1);
    expect(cachedStepTwoRuns).toBe(3);
    expect(result.output).toEqual({ notified: true, prevCharged: true });
    expect(result.retryCount).toBeGreaterThanOrEqual(2);
  });

  it('should pause and resume a workflow manually', async () => {
    const resourceId = `test-pause-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-pause-resume',
      resourceId,
      input: {},
    });

    // Wait until workflow pauses at step.pause()
    const paused = await waitForStatus(run.id, resourceId, ['paused']);
    expect(paused.status).toBe(WorkflowStatus.PAUSED);
    expect(paused.currentStepId).toBe('manual-pause');

    // Resume the workflow
    await engine.resumeWorkflow({ runId: run.id, resourceId });

    // Wait for completion
    const result = await waitForStatus(run.id, resourceId, ['completed']);
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.output).toEqual({
      before: { phase: 'before' },
      after: { phase: 'after', prev: 'before' },
    });
  });

  it('should cancel a running workflow', async () => {
    const resourceId = `test-cancel-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-cancel',
      resourceId,
      input: {},
    });

    // Wait until workflow pauses at waitFor
    const paused = await waitForStatus(run.id, resourceId, ['paused']);
    expect(paused.status).toBe(WorkflowStatus.PAUSED);

    // Cancel it
    const cancelled = await engine.cancelWorkflow({ runId: run.id, resourceId });
    expect(cancelled.status).toBe(WorkflowStatus.CANCELLED);

    // Verify via getRun
    const final = await engine.getRun({ runId: run.id, resourceId });
    expect(final.status).toBe(WorkflowStatus.CANCELLED);
  });

  it('should track progress with checkProgress', async () => {
    const resourceId = `test-progress-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      resourceId,
      input: {},
    });

    // Immediately check - should be running or already completed
    const initial = await engine.checkProgress({ runId: run.id, resourceId });
    expect(initial.totalSteps).toBe(3);
    expect(['running', 'completed']).toContain(initial.status);

    // Wait for completion
    const result = await waitForStatus(run.id, resourceId, ['completed']);
    expect(result.completionPercentage).toBe(100);
    expect(result.completedSteps).toBe(3);
  });

  it('should list runs with getRuns', async () => {
    const resourceId = `test-list-${Date.now()}`;

    // Start a few workflows
    const run1 = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      resourceId,
      input: {},
    });
    const run2 = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      resourceId,
      input: {},
    });

    // Wait for both to complete
    await waitForStatus(run1.id, resourceId, ['completed']);
    await waitForStatus(run2.id, resourceId, ['completed']);

    const { items } = await engine.getRuns({
      resourceId,
      statuses: [WorkflowStatus.COMPLETED],
      limit: 10,
    });

    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const item of items) {
      expect(item.status).toBe(WorkflowStatus.COMPLETED);
      expect(item.resourceId).toBe(resourceId);
    }
  });

  describe('dead-letter recovery for stuck runs', () => {
    const insertStuckRun = async ({
      workflowId,
      retryCount,
      maxRetries,
      status,
      resourceId,
    }: {
      workflowId: string;
      retryCount: number;
      maxRetries: number;
      status: WorkflowStatus;
      resourceId: string;
    }) => {
      const runId = `run_dlq_${Math.random().toString(36).slice(2, 12)}`;
      const now = new Date();
      await pool.query(
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
          JSON.stringify({}),
          maxRetries,
          retryCount,
          '{}',
          now,
          now,
        ],
      );
      return runId;
    };

    const sendToDlq = async (runId: string, resourceId: string, workflowId: string) => {
      // Reuse the engine's pg-boss instance so we send to the same schema
      // that the DLQ worker is listening on.
      const boss = (engine as unknown as { boss: PgBoss }).boss;
      await boss.send(WORKFLOW_RUN_DLQ_QUEUE_NAME, {
        runId,
        resourceId,
        workflowId,
        input: {},
      });
    };

    it('should configure the workflow-run queue with the DLQ + heartbeat options', async () => {
      const { rows } = await pool.query<{
        retry_limit: number;
        dead_letter: string | null;
        heartbeat_seconds: number | null;
      }>(
        `SELECT retry_limit, dead_letter, heartbeat_seconds
           FROM ${DEFAULT_PGBOSS_SCHEMA}.queue
          WHERE name = $1`,
        ['workflow-run'],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].retry_limit).toBe(0);
      expect(rows[0].dead_letter).toBe(WORKFLOW_RUN_DLQ_QUEUE_NAME);
      expect(rows[0].heartbeat_seconds).toBe(30);
    });

    it('should retry a stuck RUNNING run when retries are available', async () => {
      const resourceId = `test-dlq-retry-${Date.now()}`;
      const runId = await insertStuckRun({
        workflowId: 'integration-sequential',
        retryCount: 0,
        maxRetries: 3,
        status: WorkflowStatus.RUNNING,
        resourceId,
      });

      await sendToDlq(runId, resourceId, 'integration-sequential');

      // DLQ worker bumps retryCount and re-enqueues; main worker resumes the
      // workflow from scratch and completes it.
      const result = await waitForStatus(runId, resourceId, ['completed'], 15_000);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(result.retryCount).toBeGreaterThanOrEqual(1);
    });

    it('should mark a stuck RUNNING run as FAILED when retries are exhausted', async () => {
      const resourceId = `test-dlq-fail-${Date.now()}`;
      const runId = await insertStuckRun({
        workflowId: 'integration-sequential',
        retryCount: 2,
        maxRetries: 2,
        status: WorkflowStatus.RUNNING,
        resourceId,
      });

      await sendToDlq(runId, resourceId, 'integration-sequential');

      const result = await waitForStatus(runId, resourceId, ['failed'], 10_000);
      expect(result.status).toBe(WorkflowStatus.FAILED);
      expect(result.error).toContain('worker died');
    });

    it('should not modify runs that are no longer in RUNNING status', async () => {
      const resourceId = `test-dlq-noop-${Date.now()}`;
      const runId = await insertStuckRun({
        workflowId: 'integration-sequential',
        retryCount: 0,
        maxRetries: 2,
        status: WorkflowStatus.COMPLETED,
        resourceId,
      });

      await sendToDlq(runId, resourceId, 'integration-sequential');

      // Give the DLQ worker time to process and confirm no state change.
      await sleep(2000);

      const after = await engine.getRun({ runId, resourceId });
      expect(after.status).toBe(WorkflowStatus.COMPLETED);
      expect(after.retryCount).toBe(0);
    });

    it('should route a real failed job to the DLQ via pg-boss when handler re-throws', async () => {
      // Define a workflow that always fails; with retries=0 the engine catch
      // marks the run FAILED then re-throws, which makes pg-boss fail the job.
      // Because retryLimit: 0 + deadLetter is set on the queue, pg-boss copies
      // the payload to workflow_run_dlq. The DLQ worker sees status=FAILED and
      // no-ops — verifying the entire pipeline wires up correctly.
      const alwaysFails = workflow(
        'integration-dlq-route',
        async ({ step }) => {
          await step.run('boom', async () => {
            throw new Error('intentional boom');
          });
        },
        { retries: 0 },
      );
      await engine.registerWorkflow(alwaysFails);

      const resourceId = `test-dlq-route-${Date.now()}`;
      const run = await engine.startWorkflow({
        workflowId: 'integration-dlq-route',
        resourceId,
        input: {},
      });

      const result = await waitForStatus(run.id, resourceId, ['failed'], 10_000);
      expect(result.status).toBe(WorkflowStatus.FAILED);

      // Confirm pg-boss actually routed the failed job to the DLQ table by
      // checking that a DLQ job exists with this runId.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM ${DEFAULT_PGBOSS_SCHEMA}.job
          WHERE name = $1 AND data->>'runId' = $2`,
        [WORKFLOW_RUN_DLQ_QUEUE_NAME, run.id],
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);

      await engine.unregisterWorkflow('integration-dlq-route');
    });
  });

  it('should persist step results in timeline', async () => {
    const resourceId = `test-timeline-${Date.now()}`;
    const run = await engine.startWorkflow({
      workflowId: 'integration-sequential',
      resourceId,
      input: {},
    });

    const result = await waitForStatus(run.id, resourceId, ['completed']);
    const timeline = result.timeline as Record<string, { output: unknown; timestamp: string }>;

    // Each step should have an entry with output and timestamp
    expect(timeline['step-1']).toBeDefined();
    expect(timeline['step-1'].output).toEqual({ value: 'one' });
    expect(timeline['step-1'].timestamp).toBeTruthy();

    expect(timeline['step-2']).toBeDefined();
    expect(timeline['step-2'].output).toEqual({ value: 'two', prev: 'one' });

    expect(timeline['step-3']).toBeDefined();
    expect(timeline['step-3'].output).toEqual({ value: 'three', prev: 'two' });
  });

  describe('fastForward', () => {
    it('should fast-forward a waitFor step with fastForwardWorkflow method', async () => {
      const resourceId = `test-ff-method-${Date.now()}`;
      const run = await engine.startWorkflow({
        resourceId,
        workflowId: 'integration-wait-for-event',
        input: {},
      });

      // Wait for workflow to pause at waitFor step
      const paused = await waitForStatus(run.id, resourceId, ['paused']);
      expect(paused.currentStepId).toBe('wait-for-approval');

      // Fast-forward with mock data
      await engine.fastForwardWorkflow({
        runId: run.id,
        resourceId,
        data: { approved: true, reviewer: 'ff-test' },
      });

      // Wait for completion
      const result = await waitForStatus(run.id, resourceId, ['completed']);
      expect(result.status).toBe('completed');
      expect(result.output).toEqual({
        setup: { ready: true },
        approved: true,
      });
    });
  });
});
