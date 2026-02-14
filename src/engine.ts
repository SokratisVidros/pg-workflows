import merge from 'lodash/merge';
import type { Db, Job, PgBoss } from 'pg-boss';
import type { z } from 'zod';
import { parseWorkflowHandler } from './ast-parser';
import { runMigrations } from './db/migration';
import {
  getWorkflowRun,
  getWorkflowRuns,
  insertWorkflowRun,
  updateWorkflowRun,
  withPostgresTransaction,
} from './db/queries';
import type { WorkflowRun } from './db/types';
import { WorkflowEngineError, WorkflowRunNotFoundError } from './error';
import {
  type InternalWorkflowDefinition,
  type InternalWorkflowLogger,
  type InternalWorkflowLoggerContext,
  type inferParameters,
  type Parameters,
  StepType,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowLogger,
  type WorkflowRunProgress,
  WorkflowStatus,
} from './types';

const PAUSE_EVENT_NAME = '__internal_pause';
const WORKFLOW_RUN_QUEUE_NAME = 'workflow-run';
const LOG_PREFIX = '[WorkflowEngine]';

const StepTypeToIcon = {
  [StepType.RUN]: 'λ',
  [StepType.WAIT_FOR]: '○',
  [StepType.PAUSE]: '⏸',
  [StepType.WAIT_UNTIL]: '⏲',
};

// Timeline entry types
type TimelineStepEntry = {
  output?: unknown;
  timestamp: Date;
};

type TimelineWaitForEntry = {
  waitFor: {
    eventName: string;
    timeout?: number;
  };
  timestamp: Date;
};

type WorkflowRunJobParameters = {
  runId: string;
  resourceId?: string;
  workflowId: string;
  input: unknown;
  event?: {
    name: string;
    data?: Record<string, unknown>;
  };
};

const defaultLogger: WorkflowLogger = {
  log: (_message: string) => console.warn(_message),
  error: (message: string, error: Error) => console.error(message, error),
};

const defaultExpireInSeconds = process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS
  ? Number.parseInt(process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS, 10)
  : 5 * 60; // 5 minutes

export class WorkflowEngine {
  private boss: PgBoss;
  private db: Db;
  private unregisteredWorkflows = new Map<string, WorkflowDefinition>();
  private _started = false;

  public workflows: Map<string, InternalWorkflowDefinition> = new Map<
    string,
    InternalWorkflowDefinition
  >();
  private logger: InternalWorkflowLogger;

  constructor({
    workflows,
    logger,
    boss,
  }: Partial<{
    workflows: WorkflowDefinition[];
    logger: WorkflowLogger;
    boss: PgBoss;
  }> = {}) {
    this.logger = this.buildLogger(logger ?? defaultLogger);

    if (workflows) {
      this.unregisteredWorkflows = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    }

    if (!boss) {
      throw new WorkflowEngineError('PgBoss instance is required in constructor');
    }
    this.boss = boss;
    this.db = boss.getDb();
  }

  async start(
    asEngine = true,
    { batchSize }: { batchSize?: number } = { batchSize: 1 },
  ): Promise<void> {
    if (this._started) {
      return;
    }

    // Start boss first to get the database connection
    await this.boss.start();

    await runMigrations(this.boss.getDb());

    if (this.unregisteredWorkflows.size > 0) {
      for (const workflow of this.unregisteredWorkflows.values()) {
        await this.registerWorkflow(workflow);
      }
    }

    await this.boss.createQueue(WORKFLOW_RUN_QUEUE_NAME);

    const numWorkers: number = +(process.env.WORKFLOW_RUN_WORKERS ?? 3);

    if (asEngine) {
      for (let i = 0; i < numWorkers; i++) {
        await this.boss.work<WorkflowRunJobParameters>(
          WORKFLOW_RUN_QUEUE_NAME,
          { pollingIntervalSeconds: 0.5, batchSize },
          (job) => this.handleWorkflowRun(job),
        );
        this.logger.log(
          `Worker ${i + 1}/${numWorkers} started for queue ${WORKFLOW_RUN_QUEUE_NAME}`,
        );
      }
    }

    this._started = true;

    this.logger.log('Workflow engine started!');
  }

  async stop(): Promise<void> {
    await this.boss.stop();

    this._started = false;

    this.logger.log('Workflow engine stopped');
  }

  async registerWorkflow(definition: WorkflowDefinition): Promise<WorkflowEngine> {
    if (this.workflows.has(definition.id)) {
      throw new WorkflowEngineError(
        `Workflow ${definition.id} is already registered`,
        definition.id,
      );
    }

    const { steps } = parseWorkflowHandler(definition.handler);

    this.workflows.set(definition.id, {
      ...definition,
      steps,
    });

    this.logger.log(`Registered workflow "${definition.id}" with steps:`);
    for (const step of steps.values()) {
      const tags = [];
      if (step.conditional) tags.push('[conditional]');
      if (step.loop) tags.push('[loop]');
      if (step.isDynamic) tags.push('[dynamic]');
      this.logger.log(`  └─ (${StepTypeToIcon[step.type]}) ${step.id} ${tags.join(' ')}`);
    }

    return this;
  }

  async unregisterWorkflow(workflowId: string): Promise<WorkflowEngine> {
    this.workflows.delete(workflowId);
    return this;
  }

  async unregisterAllWorkflows(): Promise<WorkflowEngine> {
    this.workflows.clear();
    return this;
  }

  async startWorkflow({
    resourceId,
    workflowId,
    input,
    options,
  }: {
    resourceId?: string;
    workflowId: string;
    input: unknown;
    options?: {
      timeout?: number;
      retries?: number;
      expireInSeconds?: number;
      batchSize?: number;
    };
  }): Promise<WorkflowRun> {
    if (!this._started) {
      await this.start(false, { batchSize: options?.batchSize ?? 1 });
    }

    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowEngineError(`Unknown workflow ${workflowId}`);
    }

    if (workflow.steps.length === 0 || !workflow.steps[0]) {
      throw new WorkflowEngineError(`Workflow ${workflowId} has no steps`, workflowId);
    }
    const initialStepId = workflow.steps[0]?.id;

    const run = await withPostgresTransaction(this.boss.getDb(), async (_db) => {
      const timeoutAt = options?.timeout
        ? new Date(Date.now() + options.timeout)
        : workflow.timeout
          ? new Date(Date.now() + workflow.timeout)
          : null;

      const insertedRun = await insertWorkflowRun(
        {
          resourceId,
          workflowId,
          currentStepId: initialStepId,
          status: WorkflowStatus.RUNNING,
          input,
          maxRetries: options?.retries ?? workflow.retries ?? 0,
          timeoutAt,
        },
        this.boss.getDb(),
      );

      const job: WorkflowRunJobParameters = {
        runId: insertedRun.id,
        resourceId,
        workflowId,
        input,
      };

      await this.boss.send(WORKFLOW_RUN_QUEUE_NAME, job, {
        startAfter: new Date(),
        expireInSeconds: options?.expireInSeconds ?? defaultExpireInSeconds,
      });

      return insertedRun;
    });

    this.logger.log('Started workflow run', {
      runId: run.id,
      workflowId,
    });

    return run;
  }

  async pauseWorkflow({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    // TODO: Pause all running steps immediately
    const run = await this.updateRun({
      runId,
      resourceId,
      data: {
        status: WorkflowStatus.PAUSED,
        pausedAt: new Date(),
      },
    });

    this.logger.log('Paused workflow run', {
      runId,
      workflowId: run.workflowId,
    });

    return run;
  }

  async resumeWorkflow({
    runId,
    resourceId,
    options,
  }: {
    runId: string;
    resourceId?: string;
    options?: { expireInSeconds?: number };
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    return this.triggerEvent({
      runId,
      resourceId,
      eventName: PAUSE_EVENT_NAME,
      data: {},
      options,
    });
  }

  async cancelWorkflow({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    const run = await this.updateRun({
      runId,
      resourceId,
      data: {
        status: WorkflowStatus.CANCELLED,
      },
    });

    this.logger.log(`cancelled workflow run with id ${runId}`);

    return run;
  }

  async triggerEvent({
    runId,
    resourceId,
    eventName,
    data,
    options,
  }: {
    runId: string;
    resourceId?: string;
    eventName: string;
    data?: Record<string, unknown>;
    options?: {
      expireInSeconds?: number;
    };
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    const run = await this.getRun({ runId, resourceId });

    const job: WorkflowRunJobParameters = {
      runId: run.id,
      resourceId,
      workflowId: run.workflowId,
      input: run.input,
      event: {
        name: eventName,
        data,
      },
    };

    this.boss.send(WORKFLOW_RUN_QUEUE_NAME, job, {
      expireInSeconds: options?.expireInSeconds ?? defaultExpireInSeconds,
    });

    this.logger.log(`event ${eventName} sent for workflow run with id ${runId}`);
    return run;
  }

  async getRun(
    { runId, resourceId }: { runId: string; resourceId?: string },
    { exclusiveLock = false, db }: { exclusiveLock?: boolean; db?: Db } = {},
  ): Promise<WorkflowRun> {
    const run = await getWorkflowRun({ runId, resourceId }, { exclusiveLock, db: db ?? this.db });

    if (!run) {
      throw new WorkflowRunNotFoundError(runId);
    }

    return run;
  }

  async updateRun(
    {
      runId,
      resourceId,
      data,
    }: {
      runId: string;
      resourceId?: string;
      data: Partial<WorkflowRun>;
    },
    { db }: { db?: Db } = {},
  ): Promise<WorkflowRun> {
    const run = await updateWorkflowRun({ runId, resourceId, data }, db ?? this.db);

    if (!run) {
      throw new WorkflowRunNotFoundError(runId);
    }

    return run;
  }

  async checkProgress({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRunProgress> {
    const run = await this.getRun({ runId, resourceId });
    const workflow = this.workflows.get(run.workflowId);

    if (!workflow) {
      throw new WorkflowEngineError(`Workflow ${run.workflowId} not found`, run.workflowId, runId);
    }
    const steps = workflow?.steps ?? [];

    let completionPercentage = 0;
    let completedSteps = 0;

    if (steps.length > 0) {
      completedSteps = Object.values(run.timeline).filter(
        (step): step is TimelineStepEntry =>
          typeof step === 'object' &&
          step !== null &&
          'output' in step &&
          step.output !== undefined,
      ).length;

      if (run.status === WorkflowStatus.COMPLETED) {
        completionPercentage = 100;
      } else if (run.status === WorkflowStatus.FAILED || run.status === WorkflowStatus.CANCELLED) {
        completionPercentage = Math.min((completedSteps / steps.length) * 100, 100);
      } else {
        const currentStepIndex = steps.findIndex((step) => step.id === run.currentStepId);
        if (currentStepIndex >= 0) {
          completionPercentage = (currentStepIndex / steps.length) * 100;
        } else {
          const completedSteps = Object.keys(run.timeline).length;

          completionPercentage = Math.min((completedSteps / steps.length) * 100, 100);
        }
      }
    }

    return {
      ...run,
      completedSteps,
      completionPercentage: Math.round(completionPercentage * 100) / 100, // Round to 2 decimal places
      totalSteps: steps.length,
    };
  }

  private async handleWorkflowRun([job]: Job<WorkflowRunJobParameters>[]) {
    const { runId, resourceId, workflowId, input, event } = job?.data ?? {};

    if (!runId) {
      throw new WorkflowEngineError('Invalid workflow run job, missing runId', workflowId);
    }

    if (!resourceId) {
      throw new WorkflowEngineError('Invalid workflow run job, missing resourceId', workflowId);
    }

    if (!workflowId) {
      throw new WorkflowEngineError(
        'Invalid workflow run job, missing workflowId',
        undefined,
        runId,
      );
    }

    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowEngineError(`Workflow ${workflowId} not found`, workflowId, runId);
    }

    this.logger.log('Processing workflow run...', {
      runId,
      workflowId,
    });

    let run = await this.getRun({ runId, resourceId });

    try {
      if (run.status === WorkflowStatus.CANCELLED) {
        this.logger.log(`Workflow run ${runId} is cancelled, skipping`);
        return;
      }

      if (!run.currentStepId) {
        throw new WorkflowEngineError('Missing current step id', workflowId, runId);
      }

      if (run.status === WorkflowStatus.PAUSED) {
        const waitForStepEntry = run.timeline[`${run.currentStepId}-wait-for`];
        const waitForStep =
          waitForStepEntry && typeof waitForStepEntry === 'object' && 'waitFor' in waitForStepEntry
            ? (waitForStepEntry as TimelineWaitForEntry)
            : null;
        const currentStepEntry = run.timeline[run.currentStepId];
        const currentStep =
          currentStepEntry && typeof currentStepEntry === 'object' && 'output' in currentStepEntry
            ? (currentStepEntry as TimelineStepEntry)
            : null;
        const waitFor = waitForStep?.waitFor;
        const hasCurrentStepOutput = currentStep?.output !== undefined;

        if (waitFor && waitFor.eventName === event?.name && !hasCurrentStepOutput) {
          run = await this.updateRun({
            runId,
            resourceId,
            data: {
              status: WorkflowStatus.RUNNING,
              pausedAt: null,
              resumedAt: new Date(),
              timeline: merge(run.timeline, {
                [run.currentStepId]: {
                  output: event?.data ?? {},
                  timestamp: new Date(),
                },
              }),
              jobId: job?.id,
            },
          });
        } else {
          run = await this.updateRun({
            runId,
            resourceId,
            data: {
              status: WorkflowStatus.RUNNING,
              pausedAt: null,
              resumedAt: new Date(),
              jobId: job?.id,
            },
          });
        }
      }

      const context: WorkflowContext = {
        input: run.input as z.ZodTypeAny,
        workflowId: run.workflowId,
        runId: run.id,
        timeline: run.timeline,
        logger: this.logger,
        step: {
          run: async <T>(stepId: string, handler: () => Promise<T>) => {
            if (!run) {
              throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
            }

            return this.runStep({
              stepId,
              run,
              handler,
            }) as Promise<T>;
          },
          waitFor: async <T extends Parameters>(
            stepId: string,
            { eventName, timeout }: { eventName: string; timeout?: number; schema?: T },
          ) => {
            if (!run) {
              throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
            }
            return this.waitForEvent({
              run,
              stepId,
              eventName,
              timeout,
            }) as Promise<inferParameters<T>>;
          },
          // @ts-expect-error TODO: Implement waitUntil
          waitUntil: async ({ date }: { date: Date }) => {
            return this.waitUntil(runId, date);
          },
          pause: async (stepId: string) => {
            if (!run) {
              throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
            }
            return this.pauseStep({
              stepId,
              run,
            });
          },
        },
      };

      const result = await workflow.handler(context);

      run = await this.getRun({ runId, resourceId });

      if (
        run.status === WorkflowStatus.RUNNING &&
        run.currentStepId === workflow.steps[workflow.steps.length - 1]?.id
      ) {
        const normalizedResult = result === undefined ? {} : result;
        await this.updateRun({
          runId,
          resourceId,
          data: {
            status: WorkflowStatus.COMPLETED,
            output: normalizedResult,
            completedAt: new Date(),
            jobId: job?.id,
          },
        });

        this.logger.log('Workflow run completed.', {
          runId,
          workflowId,
        });
      }
    } catch (error) {
      if (run.retryCount < run.maxRetries) {
        await this.updateRun({
          runId,
          resourceId,
          data: {
            retryCount: run.retryCount + 1,
            jobId: job?.id,
          },
        });

        const retryDelay = 2 ** run.retryCount * 1000;

        // NOTE: Do not use pg-boss retryLimit and retryBackoff so that we can fully control the retry logic from the WorkflowEngine and not PGBoss.
        const pgBossJob: WorkflowRunJobParameters = {
          runId,
          resourceId,
          workflowId,
          input,
        };
        await this.boss?.send('workflow-run', pgBossJob, { retryDelay });

        return;
      }

      // TODO: Ensure that this code always runs, even if worker is stopped unexpectedly.
      await this.updateRun({
        runId,
        resourceId,
        data: {
          status: WorkflowStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          jobId: job?.id,
        },
      });

      throw error;
    }
  }

  private async runStep({
    stepId,
    run,
    handler,
  }: {
    stepId: string;
    run: WorkflowRun;
    handler: () => Promise<unknown>;
  }) {
    return withPostgresTransaction(this.db, async (db) => {
      const persistedRun = await this.getRun(
        { runId: run.id, resourceId: run.resourceId ?? undefined },
        {
          exclusiveLock: true,
          db,
        },
      );

      if (
        persistedRun.status === WorkflowStatus.CANCELLED ||
        persistedRun.status === WorkflowStatus.PAUSED ||
        persistedRun.status === WorkflowStatus.FAILED
      ) {
        this.logger.log(`Step ${stepId} skipped, workflow run is ${persistedRun.status}`, {
          runId: run.id,
          workflowId: run.workflowId,
        });

        return;
      }

      try {
        let result: unknown;

        // If the step has already been run, return the result
        const timelineStepEntry = persistedRun.timeline[stepId];
        const timelineStep =
          timelineStepEntry &&
          typeof timelineStepEntry === 'object' &&
          'output' in timelineStepEntry
            ? (timelineStepEntry as TimelineStepEntry)
            : null;
        if (timelineStep?.output !== undefined) {
          result = timelineStep.output;
        } else {
          await this.updateRun(
            {
              runId: run.id,
              resourceId: run.resourceId ?? undefined,
              data: {
                currentStepId: stepId,
              },
            },
            { db },
          );

          this.logger.log(`Running step ${stepId}...`, {
            runId: run.id,
            workflowId: run.workflowId,
          });

          result = await handler();

          run = await this.updateRun(
            {
              runId: run.id,
              resourceId: run.resourceId ?? undefined,
              data: {
                timeline: merge(run.timeline, {
                  [stepId]: {
                    output: result === undefined ? {} : result,
                    timestamp: new Date(),
                  },
                }),
              },
            },
            { db },
          );
        }

        const finalResult = result === undefined ? {} : result;
        return finalResult;
      } catch (error) {
        this.logger.error(`Step ${stepId} failed:`, error as Error, {
          runId: run.id,
          workflowId: run.workflowId,
        });

        await this.updateRun(
          {
            runId: run.id,
            resourceId: run.resourceId ?? undefined,
            data: {
              status: WorkflowStatus.FAILED,
              error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
            },
          },
          { db },
        );

        throw error;
      }
    });
  }

  private async waitForEvent({
    run,
    stepId,
    eventName,
    timeout,
  }: {
    run: WorkflowRun;
    stepId: string;
    eventName: string;
    timeout?: number;
  }) {
    const persistedRun = await this.getRun({
      runId: run.id,
      resourceId: run.resourceId ?? undefined,
    });

    if (
      persistedRun.status === WorkflowStatus.CANCELLED ||
      persistedRun.status === WorkflowStatus.PAUSED ||
      persistedRun.status === WorkflowStatus.FAILED
    ) {
      this.logger.log(`Step ${stepId} skipped, workflow run is ${persistedRun.status}`, {
        runId: run.id,
        workflowId: run.workflowId,
      });

      return;
    }

    const timelineStepCheckEntry = persistedRun.timeline[stepId];
    const timelineStepCheck =
      timelineStepCheckEntry &&
      typeof timelineStepCheckEntry === 'object' &&
      'output' in timelineStepCheckEntry
        ? (timelineStepCheckEntry as TimelineStepEntry)
        : null;
    if (timelineStepCheck?.output !== undefined) {
      return timelineStepCheck.output;
    }

    await this.updateRun({
      runId: run.id,
      resourceId: run.resourceId ?? undefined,
      data: {
        status: WorkflowStatus.PAUSED,
        currentStepId: stepId,
        timeline: merge(run.timeline, {
          [`${stepId}-wait-for`]: {
            waitFor: {
              eventName,
              timeout,
            },
            timestamp: new Date(),
          },
        }),
        pausedAt: new Date(),
      },
    });

    this.logger.log(`Running step ${stepId}, waiting for event ${eventName}...`, {
      runId: run.id,
      workflowId: run.workflowId,
    });
  }

  private async pauseStep({ stepId, run }: { stepId: string; run: WorkflowRun }): Promise<void> {
    await this.waitForEvent({
      run,
      stepId,
      eventName: PAUSE_EVENT_NAME,
    });
  }

  private async waitUntil(runId: string, _date: Date): Promise<void> {
    throw new WorkflowEngineError('Not implemented yet', undefined, runId);
  }

  private async checkIfHasStarted(): Promise<void> {
    if (!this._started) {
      throw new WorkflowEngineError('Workflow engine not started');
    }
  }

  private buildLogger(logger: WorkflowLogger): InternalWorkflowLogger {
    return {
      log: (message: string, context?: InternalWorkflowLoggerContext) => {
        const { runId, workflowId } = context ?? {};
        const parts = [LOG_PREFIX, workflowId, runId].filter(Boolean).join(' ');
        logger.log(`${parts}: ${message}`);
      },
      error: (message: string, error: Error, context?: InternalWorkflowLoggerContext) => {
        const { runId, workflowId } = context ?? {};
        const parts = [LOG_PREFIX, workflowId, runId].filter(Boolean).join(' ');
        logger.error(`${parts}: ${message}`, error);
      },
    };
  }

  async getRuns({
    resourceId,
    startingAfter,
    endingBefore,
    limit = 20,
    statuses,
    workflowId,
  }: {
    resourceId?: string;
    startingAfter?: string | null;
    endingBefore?: string | null;
    limit?: number;
    statuses?: WorkflowStatus[];
    workflowId?: string;
  }): Promise<{
    items: WorkflowRun[];
    nextCursor: string | null;
    prevCursor: string | null;
    hasMore: boolean;
    hasPrev: boolean;
  }> {
    return getWorkflowRuns(
      {
        resourceId,
        startingAfter,
        endingBefore,
        limit,
        statuses,
        workflowId,
      },
      this.db,
    );
  }
}
