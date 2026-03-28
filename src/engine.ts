import { merge } from 'es-toolkit';
import pg from 'pg';
import { type Db, type Job, PgBoss } from 'pg-boss';
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
import type { Duration } from './duration';
import { parseDuration } from './duration';
import { WorkflowEngineError, WorkflowRunNotFoundError } from './error';
import {
  type InferInputParameters,
  type InputParameters,
  type StepBaseContext,
  StepType,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowInternalDefinition,
  type WorkflowInternalLogger,
  type WorkflowInternalLoggerContext,
  type WorkflowLogger,
  type WorkflowRunProgress,
  WorkflowStatus,
} from './types';

const PAUSE_EVENT_NAME = '__internal_pause';
const WORKFLOW_RUN_QUEUE_NAME = 'workflow-run';
const LOG_PREFIX = '[WorkflowEngine]';
const DEFAULT_PGBOSS_SCHEMA = 'pgboss_v12_pgworkflow';

export type WorkflowEngineOptions = {
  workflows?: WorkflowDefinition[];
  logger?: WorkflowLogger;
  boss?: PgBoss;
} & ({ pool: pg.Pool; connectionString?: never } | { connectionString: string; pool?: never });

const StepTypeToIcon = {
  [StepType.RUN]: 'λ',
  [StepType.WAIT_FOR]: '○',
  [StepType.PAUSE]: '⏸',
  [StepType.WAIT_UNTIL]: '⏲',
  [StepType.DELAY]: '⏱',
  [StepType.POLL]: '↻',
};

// Timeline entry types
type TimelineStepEntry = {
  output?: unknown;
  timedOut?: true;
  timestamp: Date;
};

type TimelineWaitForEntry = {
  waitFor: {
    eventName?: string;
    timeoutEvent?: string;
    skipOutput?: true;
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
  private pool: pg.Pool;
  private _ownsPool = false;
  private unregisteredWorkflows = new Map<string, WorkflowDefinition>();
  private _started = false;

  public workflows: Map<string, WorkflowInternalDefinition> = new Map<
    string,
    WorkflowInternalDefinition
  >();
  private logger: WorkflowInternalLogger;

  constructor({ workflows, logger, boss, ...connectionOptions }: WorkflowEngineOptions) {
    this.logger = this.buildLogger(logger ?? defaultLogger);

    if ('pool' in connectionOptions && connectionOptions.pool) {
      this.pool = connectionOptions.pool;
    } else if ('connectionString' in connectionOptions && connectionOptions.connectionString) {
      this.pool = new pg.Pool({ connectionString: connectionOptions.connectionString });
      this._ownsPool = true;
    } else {
      throw new WorkflowEngineError('Either pool or connectionString must be provided');
    }

    if (workflows) {
      this.unregisteredWorkflows = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    }

    const db: Db = {
      executeSql: (text: string, values?: unknown[]) =>
        this.pool.query(text, values) as Promise<{ rows: unknown[] }>,
    };

    if (boss) {
      this.boss = boss;
    } else {
      this.boss = new PgBoss({ db, schema: DEFAULT_PGBOSS_SCHEMA });
    }
    this.db = this.boss.getDb();
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

    if (this._ownsPool) {
      await this.pool.end();
    }

    this._started = false;

    this.logger.log('Workflow engine stopped');
  }

  async registerWorkflow<TStep extends StepBaseContext>(
    definition: WorkflowDefinition<InputParameters, TStep>,
  ): Promise<WorkflowEngine> {
    if (this.workflows.has(definition.id)) {
      throw new WorkflowEngineError(
        `Workflow ${definition.id} is already registered`,
        definition.id,
      );
    }

    const { steps } = parseWorkflowHandler(
      definition.handler as (context: WorkflowContext) => Promise<unknown>,
    );

    this.workflows.set(definition.id, {
      ...definition,
      steps,
    } as WorkflowInternalDefinition);

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

    const hasSteps = workflow.steps.length > 0 && workflow.steps[0];
    const hasPlugins = (workflow.plugins?.length ?? 0) > 0;
    if (!hasSteps && !hasPlugins) {
      throw new WorkflowEngineError(`Workflow ${workflowId} has no steps`, workflowId);
    }
    if (workflow.inputSchema) {
      const result = workflow.inputSchema.safeParse(input);
      if (!result.success) {
        throw new WorkflowEngineError(result.error.message, workflowId);
      }
    }

    const initialStepId = workflow.steps[0]?.id ?? '__start__';

    const run = await withPostgresTransaction(
      this.boss.getDb(),
      async (_db) => {
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
          _db,
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
      },
      this.pool,
    );

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

    const current = await this.getRun({ runId, resourceId });
    if (current.status !== WorkflowStatus.RUNNING && current.status !== WorkflowStatus.PENDING) {
      throw new WorkflowEngineError(
        `Cannot pause workflow run in '${current.status}' status, must be 'running' or 'pending'`,
        current.workflowId,
        runId,
      );
    }

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

    const current = await this.getRun({ runId, resourceId });
    if (current.status !== WorkflowStatus.PAUSED) {
      throw new WorkflowEngineError(
        `Cannot resume workflow run in '${current.status}' status, must be 'paused'`,
        current.workflowId,
        runId,
      );
    }

    return this.triggerEvent({
      runId,
      resourceId,
      eventName: PAUSE_EVENT_NAME,
      data: {},
      options,
    });
  }

  async fastForwardWorkflow({
    runId,
    resourceId,
    data,
  }: {
    runId: string;
    resourceId?: string;
    data?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    const run = await this.getRun({ runId, resourceId });

    if (run.status !== WorkflowStatus.PAUSED) {
      return run;
    }

    const stepId = run.currentStepId;
    const waitForStep = this.getWaitForStepEntry(run.timeline, stepId);

    if (!waitForStep) {
      return run;
    }

    const { eventName, timeoutEvent, skipOutput } = waitForStep.waitFor;

    // step.pause() — delegate to resumeWorkflow
    if (eventName === PAUSE_EVENT_NAME) {
      return this.resumeWorkflow({ runId, resourceId });
    }

    // step.poll() — write output to timeline first, then trigger resume
    if (skipOutput && timeoutEvent) {
      await withPostgresTransaction(
        this.db,
        async (db) => {
          const freshRun = await this.getRun({ runId, resourceId }, { exclusiveLock: true, db });
          return this.updateRun(
            {
              runId,
              resourceId,
              data: {
                timeline: merge(freshRun.timeline, {
                  [stepId]: {
                    output: data ?? {},
                    timestamp: new Date(),
                  },
                }),
              },
            },
            { db },
          );
        },
        this.pool,
      );

      return this.triggerEvent({ runId, resourceId, eventName: timeoutEvent });
    }

    // waitFor steps — trigger the event with data
    if (eventName) {
      return this.triggerEvent({ runId, resourceId, eventName, data: data ?? {} });
    }

    // delay/waitUntil steps — trigger the timeout event
    if (timeoutEvent) {
      return this.triggerEvent({ runId, resourceId, eventName: timeoutEvent, data: data ?? {} });
    }

    return run;
  }

  async cancelWorkflow({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRun> {
    await this.checkIfHasStarted();

    const current = await this.getRun({ runId, resourceId });
    const terminalStatuses = [
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
    ];
    if (terminalStatuses.includes(current.status as WorkflowStatus)) {
      throw new WorkflowEngineError(
        `Cannot cancel workflow run in '${current.status}' status`,
        current.workflowId,
        runId,
      );
    }

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

    const jobResourceId = resourceId ?? run.resourceId ?? undefined;

    const job: WorkflowRunJobParameters = {
      runId: run.id,
      resourceId: jobResourceId,
      workflowId: run.workflowId,
      input: run.input,
      event: {
        name: eventName,
        data,
      },
    };

    await this.boss.send(WORKFLOW_RUN_QUEUE_NAME, job, {
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

  /**
   * Resolves the resource id used for scoped DB access (getRun/updateRun).
   * When the job omits resourceId, the run's stored resourceId is used.
   * When the job includes resourceId, it must match the run's resourceId if the run is scoped;
   * unscoped runs reject a job-supplied resourceId (authorization).
   */
  private resolveScopedResourceId(
    jobResourceId: string | undefined,
    run: WorkflowRun,
  ): string | undefined {
    const jobResourceProvided =
      jobResourceId !== undefined && jobResourceId !== null && jobResourceId !== '';

    if (jobResourceProvided) {
      if (run.resourceId === null) {
        throw new WorkflowRunNotFoundError(run.id);
      }
      if (run.resourceId !== jobResourceId) {
        throw new WorkflowRunNotFoundError(run.id);
      }
      return jobResourceId;
    }

    return run.resourceId ?? undefined;
  }

  private async handleWorkflowRun([job]: Job<WorkflowRunJobParameters>[]) {
    const { runId, resourceId, workflowId, input, event } = job?.data ?? {};

    if (!runId) {
      throw new WorkflowEngineError('Invalid workflow run job, missing runId', workflowId);
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

    let run = await this.getRun({ runId });

    if (run.workflowId !== workflowId) {
      throw new WorkflowEngineError(
        `Workflow run ${runId} does not match job workflowId ${workflowId}`,
        workflowId,
        runId,
      );
    }

    const scopedResourceId = this.resolveScopedResourceId(resourceId, run);

    try {
      if (run.status === WorkflowStatus.CANCELLED) {
        this.logger.log(`Workflow run ${runId} is cancelled, skipping`);
        return;
      }

      if (!run.currentStepId) {
        throw new WorkflowEngineError('Missing current step id', workflowId, runId);
      }

      if (run.status === WorkflowStatus.PAUSED) {
        run = await withPostgresTransaction(
          this.db,
          async (db) => {
            const lockedRun = await this.getRun(
              { runId, resourceId: scopedResourceId },
              { exclusiveLock: true, db },
            );

            if (lockedRun.status !== WorkflowStatus.PAUSED) {
              return lockedRun;
            }

            const waitForStep = this.getWaitForStepEntry(
              lockedRun.timeline,
              lockedRun.currentStepId,
            );
            const currentStep = this.getCachedStepEntry(
              lockedRun.timeline,
              lockedRun.currentStepId,
            );
            const waitFor = waitForStep?.waitFor;
            const hasCurrentStepOutput = currentStep?.output !== undefined;

            const eventMatches =
              waitFor &&
              event?.name &&
              (event.name === waitFor.eventName || event.name === waitFor.timeoutEvent) &&
              !hasCurrentStepOutput;

            if (eventMatches) {
              const isTimeout = event?.name === waitFor?.timeoutEvent;
              const skipOutput = waitFor?.skipOutput;
              return this.updateRun(
                {
                  runId,
                  resourceId: scopedResourceId,
                  data: {
                    status: WorkflowStatus.RUNNING,
                    pausedAt: null,
                    resumedAt: new Date(),
                    jobId: job?.id,
                    ...(skipOutput
                      ? {}
                      : {
                          timeline: merge(lockedRun.timeline, {
                            [lockedRun.currentStepId]: {
                              output: event?.data ?? {},
                              ...(isTimeout ? { timedOut: true as const } : {}),
                              timestamp: new Date(),
                            },
                          }),
                        }),
                  },
                },
                { db },
              );
            }

            return this.updateRun(
              {
                runId,
                resourceId: scopedResourceId,
                data: {
                  status: WorkflowStatus.RUNNING,
                  pausedAt: null,
                  resumedAt: new Date(),
                  jobId: job?.id,
                },
              },
              { db },
            );
          },
          this.pool,
        );
      }

      const baseStep = {
        run: async <T>(stepId: string, handler: () => Promise<T>) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          return this.runStep({ stepId, run, handler }) as Promise<T>;
        },
        waitFor: async <T extends InputParameters>(
          stepId: string,
          { eventName, timeout }: { eventName: string; timeout?: number; schema?: T },
        ) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          const timeoutDate = timeout ? new Date(Date.now() + timeout) : undefined;
          return this.waitStep({ run, stepId, eventName, timeoutDate }) as Promise<
            InferInputParameters<T> | undefined
          >;
        },
        waitUntil: async (
          stepId: string,
          dateOrOptions: Date | string | { date: Date | string },
        ) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          const date =
            dateOrOptions instanceof Date
              ? dateOrOptions
              : typeof dateOrOptions === 'string'
                ? new Date(dateOrOptions)
                : dateOrOptions.date instanceof Date
                  ? dateOrOptions.date
                  : new Date(dateOrOptions.date);
          await this.waitStep({ run, stepId, timeoutDate: date });
        },
        pause: async (stepId: string) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          await this.waitStep({ run, stepId, eventName: PAUSE_EVENT_NAME });
        },
        delay: async (stepId: string, duration: Duration) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          await this.waitStep({
            run,
            stepId,
            timeoutDate: new Date(Date.now() + parseDuration(duration)),
          });
        },
        get sleep() {
          return this.delay;
        },
        poll: async <T>(
          stepId: string,
          conditionFn: () => Promise<T | false>,
          options?: { interval?: Duration; timeout?: Duration },
        ) => {
          if (!run) {
            throw new WorkflowEngineError('Missing workflow run', workflowId, runId);
          }
          const intervalMs = parseDuration(options?.interval ?? '30s');
          if (intervalMs < 30_000) {
            throw new WorkflowEngineError(
              `step.poll interval must be at least 30s (got ${intervalMs}ms)`,
              workflowId,
              runId,
            );
          }
          const timeoutMs = options?.timeout ? parseDuration(options.timeout) : undefined;
          return this.pollStep({ run, stepId, conditionFn, intervalMs, timeoutMs }) as Promise<
            { timedOut: false; data: T } | { timedOut: true }
          >;
        },
      };

      let step = { ...baseStep };
      const plugins = workflow.plugins ?? [];
      for (const plugin of plugins) {
        const extra = plugin.methods(step);
        step = { ...step, ...extra };
      }

      const context: WorkflowContext = {
        input: run.input as z.ZodTypeAny,
        workflowId: run.workflowId,
        runId: run.id,
        timeline: run.timeline,
        logger: this.logger,
        step,
      };

      const result = await workflow.handler(context);

      run = await this.getRun({ runId, resourceId: scopedResourceId });

      const isLastParsedStep = run.currentStepId === workflow.steps[workflow.steps.length - 1]?.id;
      const hasPluginSteps = (workflow.plugins?.length ?? 0) > 0;
      const noParsedSteps = workflow.steps.length === 0;
      const shouldComplete =
        run.status === WorkflowStatus.RUNNING &&
        (noParsedSteps || isLastParsedStep || (hasPluginSteps && result !== undefined));
      if (shouldComplete) {
        const normalizedResult = result === undefined ? {} : result;
        await this.updateRun({
          runId,
          resourceId: scopedResourceId,
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
          resourceId: scopedResourceId,
          data: {
            retryCount: run.retryCount + 1,
            jobId: job?.id,
          },
        });

        const retryDelay = 2 ** run.retryCount * 1000;

        // NOTE: Do not use pg-boss retryLimit and retryBackoff so that we can fully control the retry logic from the WorkflowEngine and not PGBoss.
        const pgBossJob: WorkflowRunJobParameters = {
          runId,
          resourceId: scopedResourceId,
          workflowId,
          input,
        };
        await this.boss?.send('workflow-run', pgBossJob, {
          startAfter: new Date(Date.now() + retryDelay),
          expireInSeconds: defaultExpireInSeconds,
        });

        return;
      }

      // TODO: Ensure that this code always runs, even if worker is stopped unexpectedly.
      await this.updateRun({
        runId,
        resourceId: scopedResourceId,
        data: {
          status: WorkflowStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          jobId: job?.id,
        },
      });

      throw error;
    }
  }

  private getCachedStepEntry(
    timeline: Record<string, unknown>,
    stepId: string,
  ): TimelineStepEntry | null {
    const stepEntry = timeline[stepId];
    return stepEntry && typeof stepEntry === 'object' && 'output' in stepEntry
      ? (stepEntry as TimelineStepEntry)
      : null;
  }

  private getWaitForStepEntry(
    timeline: Record<string, unknown>,
    stepId: string,
  ): TimelineWaitForEntry | null {
    const entry = timeline[`${stepId}-wait-for`];
    return entry && typeof entry === 'object' && 'waitFor' in entry
      ? (entry as TimelineWaitForEntry)
      : null;
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
    return withPostgresTransaction(
      this.db,
      async (db) => {
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
          const cached = this.getCachedStepEntry(persistedRun.timeline, stepId);
          if (cached?.output !== undefined) {
            return cached.output;
          }

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

          let output = await handler();

          if (output === undefined) {
            output = {};
          }

          run = await this.updateRun(
            {
              runId: run.id,
              resourceId: run.resourceId ?? undefined,
              data: {
                timeline: merge(persistedRun.timeline, {
                  [stepId]: {
                    output,
                    timestamp: new Date(),
                  },
                }),
              },
            },
            { db },
          );

          return output;
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
      },
      this.pool,
    );
  }

  private async waitStep({
    run,
    stepId,
    eventName,
    timeoutDate,
  }: {
    run: WorkflowRun;
    stepId: string;
    eventName?: string;
    timeoutDate?: Date;
  }): Promise<unknown> {
    const persistedRun = await this.getRun({
      runId: run.id,
      resourceId: run.resourceId ?? undefined,
    });

    if (
      persistedRun.status === WorkflowStatus.CANCELLED ||
      persistedRun.status === WorkflowStatus.PAUSED ||
      persistedRun.status === WorkflowStatus.FAILED
    ) {
      return;
    }

    const cached = this.getCachedStepEntry(persistedRun.timeline, stepId);
    if (cached?.output !== undefined) {
      return cached.timedOut ? undefined : cached.output;
    }

    const timeoutEvent = timeoutDate ? `__timeout_${stepId}` : undefined;

    await withPostgresTransaction(
      this.db,
      async (db) => {
        const freshRun = await this.getRun(
          { runId: run.id, resourceId: run.resourceId ?? undefined },
          { exclusiveLock: true, db },
        );
        return this.updateRun(
          {
            runId: run.id,
            resourceId: run.resourceId ?? undefined,
            data: {
              status: WorkflowStatus.PAUSED,
              currentStepId: stepId,
              pausedAt: new Date(),
              timeline: merge(freshRun.timeline, {
                [`${stepId}-wait-for`]: {
                  waitFor: { eventName, timeoutEvent },
                  timestamp: new Date(),
                },
              }),
            },
          },
          { db },
        );
      },
      this.pool,
    );

    if (timeoutDate && timeoutEvent) {
      try {
        const job: WorkflowRunJobParameters = {
          runId: run.id,
          resourceId: run.resourceId ?? undefined,
          workflowId: run.workflowId,
          input: run.input,
          event: { name: timeoutEvent, data: { date: timeoutDate.toISOString() } },
        };
        await this.boss.send(WORKFLOW_RUN_QUEUE_NAME, job, {
          startAfter: timeoutDate.getTime() <= Date.now() ? new Date() : timeoutDate,
          expireInSeconds: defaultExpireInSeconds,
        });
      } catch (error) {
        // Revert PAUSED status so the workflow can retry this step
        await this.updateRun({
          runId: run.id,
          resourceId: run.resourceId ?? undefined,
          data: { status: WorkflowStatus.RUNNING, pausedAt: null },
        });
        throw error;
      }
    }

    this.logger.log(
      `Step ${stepId} waiting${eventName ? ` for event "${eventName}"` : ''}${timeoutDate ? ` until ${timeoutDate.toISOString()}` : ''}`,
      { runId: run.id, workflowId: run.workflowId },
    );
  }

  private async pollStep<T>({
    run,
    stepId,
    conditionFn,
    intervalMs,
    timeoutMs,
  }: {
    run: WorkflowRun;
    stepId: string;
    conditionFn: () => Promise<T | false>;
    intervalMs: number;
    timeoutMs?: number;
  }): Promise<{ timedOut: false; data: T } | { timedOut: true } | undefined> {
    const persistedRun = await this.getRun({
      runId: run.id,
      resourceId: run.resourceId ?? undefined,
    });

    if (
      persistedRun.status === WorkflowStatus.CANCELLED ||
      persistedRun.status === WorkflowStatus.PAUSED ||
      persistedRun.status === WorkflowStatus.FAILED
    ) {
      return { timedOut: true };
    }

    const cached = this.getCachedStepEntry(persistedRun.timeline, stepId);
    if (cached?.output !== undefined) {
      return cached.timedOut ? { timedOut: true } : { timedOut: false, data: cached.output as T };
    }

    const pollStateEntry = persistedRun.timeline[`${stepId}-poll`];
    const startedAt =
      pollStateEntry && typeof pollStateEntry === 'object' && 'startedAt' in pollStateEntry
        ? new Date((pollStateEntry as { startedAt: string }).startedAt)
        : new Date();

    if (timeoutMs !== undefined && Date.now() >= startedAt.getTime() + timeoutMs) {
      await withPostgresTransaction(
        this.db,
        async (db) => {
          const freshRun = await this.getRun(
            { runId: run.id, resourceId: run.resourceId ?? undefined },
            { exclusiveLock: true, db },
          );
          return this.updateRun(
            {
              runId: run.id,
              resourceId: run.resourceId ?? undefined,
              data: {
                currentStepId: stepId,
                timeline: merge(freshRun.timeline, {
                  [stepId]: { output: {}, timedOut: true as const, timestamp: new Date() },
                }),
              },
            },
            { db },
          );
        },
        this.pool,
      );
      return { timedOut: true };
    }

    let result: T | false;
    try {
      result = await conditionFn();
    } catch (error) {
      this.logger.error(
        `Poll conditionFn for step ${stepId} threw an error, treating as non-match and continuing to poll`,
        error as Error,
        { runId: run.id, workflowId: run.workflowId },
      );

      // If the poll has timed out, respect the timeout even though conditionFn threw
      if (timeoutMs !== undefined && Date.now() >= startedAt.getTime() + timeoutMs) {
        await withPostgresTransaction(
          this.db,
          async (db) => {
            const freshRun = await this.getRun(
              { runId: run.id, resourceId: run.resourceId ?? undefined },
              { exclusiveLock: true, db },
            );
            return this.updateRun(
              {
                runId: run.id,
                resourceId: run.resourceId ?? undefined,
                data: {
                  currentStepId: stepId,
                  timeline: merge(freshRun.timeline, {
                    [stepId]: { output: {}, timedOut: true as const, timestamp: new Date() },
                  }),
                },
              },
              { db },
            );
          },
          this.pool,
        );
        return { timedOut: true };
      }

      result = false;
    }

    if (result !== false) {
      await withPostgresTransaction(
        this.db,
        async (db) => {
          const freshRun = await this.getRun(
            { runId: run.id, resourceId: run.resourceId ?? undefined },
            { exclusiveLock: true, db },
          );
          return this.updateRun(
            {
              runId: run.id,
              resourceId: run.resourceId ?? undefined,
              data: {
                currentStepId: stepId,
                timeline: merge(freshRun.timeline, {
                  [stepId]: { output: result, timestamp: new Date() },
                }),
              },
            },
            { db },
          );
        },
        this.pool,
      );
      return { timedOut: false, data: result };
    }

    const pollEvent = `__poll_${stepId}`;
    await withPostgresTransaction(
      this.db,
      async (db) => {
        const freshRun = await this.getRun(
          { runId: run.id, resourceId: run.resourceId ?? undefined },
          { exclusiveLock: true, db },
        );
        return this.updateRun(
          {
            runId: run.id,
            resourceId: run.resourceId ?? undefined,
            data: {
              status: WorkflowStatus.PAUSED,
              currentStepId: stepId,
              pausedAt: new Date(),
              timeline: merge(freshRun.timeline, {
                [`${stepId}-poll`]: { startedAt: startedAt.toISOString() },
                [`${stepId}-wait-for`]: {
                  waitFor: { timeoutEvent: pollEvent, skipOutput: true },
                  timestamp: new Date(),
                },
              }),
            },
          },
          { db },
        );
      },
      this.pool,
    );

    try {
      await this.boss.send(
        WORKFLOW_RUN_QUEUE_NAME,
        {
          runId: run.id,
          resourceId: run.resourceId ?? undefined,
          workflowId: run.workflowId,
          input: run.input,
          event: { name: pollEvent, data: {} },
        },
        {
          startAfter: new Date(Date.now() + intervalMs),
          expireInSeconds: defaultExpireInSeconds,
        },
      );
    } catch (error) {
      // Revert PAUSED status so the workflow can retry this step
      await this.updateRun({
        runId: run.id,
        resourceId: run.resourceId ?? undefined,
        data: { status: WorkflowStatus.RUNNING, pausedAt: null },
      });
      throw error;
    }

    this.logger.log(`Step ${stepId} polling every ${intervalMs}ms...`, {
      runId: run.id,
      workflowId: run.workflowId,
    });

    return { timedOut: false, data: undefined as T };
  }

  private async checkIfHasStarted(): Promise<void> {
    if (!this._started) {
      throw new WorkflowEngineError('Workflow engine not started');
    }
  }

  private buildLogger(logger: WorkflowLogger): WorkflowInternalLogger {
    return {
      log: (message: string, context?: WorkflowInternalLoggerContext) => {
        const { runId, workflowId } = context ?? {};
        const parts = [LOG_PREFIX, workflowId, runId].filter(Boolean).join(' ');
        logger.log(`${parts}: ${message}`);
      },
      error: (message: string, error: Error, context?: WorkflowInternalLoggerContext) => {
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
