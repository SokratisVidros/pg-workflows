import { merge } from 'es-toolkit';
import pg from 'pg';
import { type Db, PgBoss } from 'pg-boss';
import {
  DEFAULT_PGBOSS_SCHEMA,
  invokeChildWorkflowTimelineKey,
  isInvokeChildWorkflowTimelineEntry,
  PAUSE_EVENT_NAME,
  WORKFLOW_RUN_QUEUE_NAME,
  waitForTimelineKey,
} from './constants';
import { runMigrations } from './db/migration';
import {
  acquireIdempotencyKeyLock,
  acquireWorkflowAdmissionLock,
  cancelConflictingSingletonRuns,
  countRunningWorkflowRunsByConcurrencyKey,
  findOldestConflictingSingletonRun,
  getPendingWorkflowRunsByWorkflowId,
  getWorkflowRun,
  getWorkflowRunByIdempotencyKey,
  getWorkflowRuns,
  insertWorkflowRun,
  updateWorkflowRun,
  withPostgresTransaction,
} from './db/queries';
import type { PersistedWorkflowRun, WorkflowRun } from './db/types';
import {
  validateResourceId,
  validateWorkflowId,
  WorkflowEngineError,
  WorkflowRunNotFoundError,
} from './error';
import { type ResolvedFlowControl, resolveFlowControl } from './flow-control';
import {
  type InferInputParameters,
  type InputParameters,
  type WorkflowLogger,
  type WorkflowRef,
  type WorkflowRunOptions,
  type WorkflowRunProgress,
  WorkflowStatus,
} from './types';

const LOG_PREFIX = '[WorkflowClient]';

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

export type WorkflowClientOptions = {
  logger?: WorkflowLogger;
  /**
   * Pre-configured pg-boss instance. Pass this when the engine side uses a
   * non-default pg-boss config (schema, retention, logger, etc.) so the
   * client enqueues jobs where the engine reads them. Mirrors the same
   * option on `WorkflowEngineOptions`.
   */
  boss?: PgBoss;
} & ({ pool: pg.Pool; connectionString?: never } | { connectionString: string; pool?: never });

export type StartWorkflowOptions = WorkflowRunOptions;

const defaultLogger: WorkflowLogger = {
  log: (_message: string) => console.warn(_message),
  error: (message: string, error: Error) => console.error(message, error),
};

const defaultExpireInSeconds = process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS
  ? Number.parseInt(process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS, 10)
  : 5 * 60;

const PAUSE_REASON_MANUAL = 'manual';

export class WorkflowClient {
  private boss: PgBoss;
  private db: Db;
  private pool: pg.Pool;
  private _ownsPool = false;
  private _started = false;
  private logger: WorkflowLogger;

  constructor({ logger, boss, ...connectionOptions }: WorkflowClientOptions) {
    this.logger = logger ?? defaultLogger;

    if ('pool' in connectionOptions && connectionOptions.pool) {
      this.pool = connectionOptions.pool;
    } else if ('connectionString' in connectionOptions && connectionOptions.connectionString) {
      this.pool = new pg.Pool({ connectionString: connectionOptions.connectionString });
      this._ownsPool = true;
    } else {
      throw new WorkflowEngineError('Either pool or connectionString must be provided');
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
    this.db = db;
  }

  async start(): Promise<void> {
    if (this._started) {
      return;
    }

    await this.boss.start();
    this.db = this.boss.getDb();
    await runMigrations(this.db);
    await this.boss.createQueue(WORKFLOW_RUN_QUEUE_NAME);

    this._started = true;
    this.logger.log(`${LOG_PREFIX} Client started`);
  }

  async stop(): Promise<void> {
    await this.boss.stop();

    if (this._ownsPool) {
      await this.pool.end();
    }

    this._started = false;
    this.logger.log(`${LOG_PREFIX} Client stopped`);
  }

  private async enqueueWorkflowRun(
    run: PersistedWorkflowRun,
    options?: { expireInSeconds?: number },
    db?: Db,
  ) {
    const job: WorkflowRunJobParameters = {
      runId: run.id,
      resourceId: run.resourceId ?? undefined,
      workflowId: run.workflowId,
      input: run.input,
    };

    await this.boss.send(WORKFLOW_RUN_QUEUE_NAME, job, {
      startAfter: new Date(),
      expireInSeconds: options?.expireInSeconds ?? defaultExpireInSeconds,
      db,
    });
  }

  private async promotePendingRuns(
    workflowId: string,
    options?: { expireInSeconds?: number },
  ): Promise<void> {
    await withPostgresTransaction(
      this.db,
      async (db) => {
        await acquireWorkflowAdmissionLock(workflowId, db);

        const pendingRuns = await getPendingWorkflowRunsByWorkflowId(workflowId, db);
        const runningCounts = new Map<string, number>();

        for (const pendingRun of pendingRuns) {
          if (!pendingRun.concurrencyKey || !pendingRun.concurrencyLimit) {
            const promoted = await updateWorkflowRun(
              {
                runId: pendingRun.id,
                resourceId: pendingRun.resourceId ?? undefined,
                data: {
                  status: WorkflowStatus.RUNNING,
                  pausedAt: null,
                  pauseReason: null,
                },
                expectedStatuses: [WorkflowStatus.PENDING],
              },
              db,
            );

            if (promoted) {
              await this.enqueueWorkflowRun(promoted, options, db);
            }
            continue;
          }

          const currentCount =
            runningCounts.get(pendingRun.concurrencyKey) ??
            (await countRunningWorkflowRunsByConcurrencyKey(
              {
                workflowId,
                concurrencyKey: pendingRun.concurrencyKey,
              },
              db,
            ));

          if (currentCount >= pendingRun.concurrencyLimit) {
            runningCounts.set(pendingRun.concurrencyKey, currentCount);
            continue;
          }

          const promoted = await updateWorkflowRun(
            {
              runId: pendingRun.id,
              resourceId: pendingRun.resourceId ?? undefined,
              data: {
                status: WorkflowStatus.RUNNING,
                pausedAt: null,
                pauseReason: null,
              },
              expectedStatuses: [WorkflowStatus.PENDING],
            },
            db,
          );

          if (!promoted) {
            continue;
          }

          runningCounts.set(pendingRun.concurrencyKey, currentCount + 1);
          await this.enqueueWorkflowRun(promoted, options, db);
        }
      },
      this.pool,
    );
  }

  async startWorkflow<TInput extends InputParameters>(
    ref: WorkflowRef<TInput>,
    input: InferInputParameters<TInput>,
    options?: StartWorkflowOptions,
  ): Promise<WorkflowRun>;

  async startWorkflow(params: {
    workflowId: string;
    input: unknown;
    resourceId?: string;
    idempotencyKey?: string;
    options?: StartWorkflowOptions;
  }): Promise<WorkflowRun>;

  async startWorkflow<TInput extends InputParameters>(
    refOrParams:
      | WorkflowRef<TInput>
      | {
          workflowId: string;
          input: unknown;
          resourceId?: string;
          idempotencyKey?: string;
          options?: StartWorkflowOptions;
        },
    inputArg?: InferInputParameters<TInput>,
    optionsArg?: StartWorkflowOptions,
  ): Promise<WorkflowRun> {
    await this.ensureStarted();

    let workflowId: string;
    let input: unknown;
    let resourceId: string | undefined;
    let idempotencyKey: string | undefined;
    let options: StartWorkflowOptions | undefined;
    let resolvedFlowControl: ResolvedFlowControl | null = null;

    if (typeof refOrParams === 'function' && 'id' in refOrParams) {
      const ref = refOrParams as WorkflowRef<TInput>;
      workflowId = ref.id;
      input = inputArg;
      options = optionsArg;
      resourceId = optionsArg?.resourceId;
      idempotencyKey = optionsArg?.idempotencyKey;

      if (ref.inputSchema) {
        const result = await ref.inputSchema['~standard'].validate(input);
        if (result.issues) {
          throw new WorkflowEngineError(
            JSON.stringify(result.issues),
            workflowId,
            undefined,
            undefined,
            result.issues,
          );
        }
      }

      resolvedFlowControl = resolveFlowControl(
        ref.flowControl,
        inputArg as InferInputParameters<TInput>,
      );
    } else {
      const params = refOrParams as {
        workflowId: string;
        input: unknown;
        resourceId?: string;
        idempotencyKey?: string;
        options?: StartWorkflowOptions;
      };
      workflowId = params.workflowId;
      input = params.input;
      resourceId = params.resourceId;
      idempotencyKey = params.idempotencyKey;
      options = params.options;
    }

    validateWorkflowId(workflowId);
    validateResourceId(resourceId);

    const run = await withPostgresTransaction(
      this.db,
      async (_db) => {
        const timeoutAt = options?.timeout ? new Date(Date.now() + options.timeout) : null;

        if (idempotencyKey) {
          await acquireIdempotencyKeyLock(idempotencyKey, _db);
          const existingByIdempotency = await getWorkflowRunByIdempotencyKey(idempotencyKey, _db);
          if (existingByIdempotency) {
            return existingByIdempotency;
          }
        }

        await acquireWorkflowAdmissionLock(workflowId, _db);

        if (resolvedFlowControl?.type === 'singleton') {
          const existingSingleton = await findOldestConflictingSingletonRun(
            {
              workflowId,
              concurrencyKey: resolvedFlowControl.concurrencyKey,
            },
            _db,
          );

          if (existingSingleton) {
            if (resolvedFlowControl.singletonMode === 'skip') {
              return existingSingleton;
            }

            await cancelConflictingSingletonRuns(
              {
                workflowId,
                concurrencyKey: resolvedFlowControl.concurrencyKey,
              },
              _db,
            );
          }
        }

        const isConcurrencyLimited = resolvedFlowControl?.type === 'concurrency';
        const status =
          isConcurrencyLimited &&
          (await countRunningWorkflowRunsByConcurrencyKey(
            {
              workflowId,
              concurrencyKey: resolvedFlowControl.concurrencyKey,
            },
            _db,
          )) >= resolvedFlowControl.concurrencyLimit
            ? WorkflowStatus.PENDING
            : WorkflowStatus.RUNNING;

        const { run: insertedRun, created } = await insertWorkflowRun(
          {
            resourceId,
            workflowId,
            currentStepId: '__start__',
            status,
            input,
            maxRetries: options?.retries ?? 0,
            timeoutAt,
            idempotencyKey,
            concurrencyKey: resolvedFlowControl?.concurrencyKey ?? null,
            concurrencyLimit:
              resolvedFlowControl?.type === 'concurrency'
                ? resolvedFlowControl.concurrencyLimit
                : null,
            singletonMode:
              resolvedFlowControl?.type === 'singleton' ? resolvedFlowControl.singletonMode : null,
          },
          _db,
        );

        if (created && insertedRun.status === WorkflowStatus.RUNNING) {
          await this.enqueueWorkflowRun(insertedRun, options, _db);
        }

        return insertedRun;
      },
      this.pool,
    );

    this.logger.log(`${LOG_PREFIX} Started workflow run ${run.id} for ${workflowId}`);

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
    options?: { expireInSeconds?: number };
  }): Promise<WorkflowRun> {
    await this.ensureStarted();

    const run = await this.getRun({ runId, resourceId });

    const job: WorkflowRunJobParameters = {
      runId: run.id,
      resourceId: resourceId ?? run.resourceId ?? undefined,
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

    this.logger.log(`${LOG_PREFIX} Event ${eventName} sent for workflow run ${runId}`);
    return run;
  }

  async pauseWorkflow({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRun> {
    await this.ensureStarted();

    const run = await updateWorkflowRun(
      {
        runId,
        resourceId,
        data: {
          status: WorkflowStatus.PAUSED,
          pausedAt: new Date(),
          pauseReason: PAUSE_REASON_MANUAL,
        },
        expectedStatuses: [WorkflowStatus.RUNNING, WorkflowStatus.PENDING],
      },
      this.db,
    );

    if (!run) {
      throw new WorkflowRunNotFoundError(runId);
    }

    await this.promotePendingRuns(run.workflowId);

    this.logger.log(`${LOG_PREFIX} Paused workflow run ${runId}`);
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
    await this.ensureStarted();

    const current = await this.getRun({ runId, resourceId });
    if (current.status !== WorkflowStatus.PAUSED) {
      throw new WorkflowEngineError(
        `Cannot resume workflow run in '${current.status}' status, must be 'paused'`,
        current.workflowId,
        runId,
      );
    }

    const currentStepId = current.currentStepId;
    const currentStepTimelineEntry =
      current.timeline[invokeChildWorkflowTimelineKey(currentStepId)];
    if (isInvokeChildWorkflowTimelineEntry(currentStepTimelineEntry)) {
      return current;
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
    await this.ensureStarted();

    const run = await this.getRun({ runId, resourceId });

    if (run.status !== WorkflowStatus.PAUSED) {
      return run;
    }

    const currentStepId = run.currentStepId;
    const currentStepTimelineEntry = run.timeline[invokeChildWorkflowTimelineKey(currentStepId)];
    if (isInvokeChildWorkflowTimelineEntry(currentStepTimelineEntry)) {
      return run;
    }

    const waitForEntry = run.timeline[waitForTimelineKey(currentStepId)];
    if (!waitForEntry || typeof waitForEntry !== 'object' || !('waitFor' in waitForEntry)) {
      return run;
    }

    const { eventName, timeoutEvent, skipOutput } = (
      waitForEntry as { waitFor: { eventName?: string; timeoutEvent?: string; skipOutput?: true } }
    ).waitFor;

    // step.pause() - delegate to resumeWorkflow
    if (eventName === PAUSE_EVENT_NAME) {
      return this.resumeWorkflow({ runId, resourceId });
    }

    // step.poll() - write output to timeline first, then trigger resume
    if (skipOutput && timeoutEvent) {
      await withPostgresTransaction(
        this.db,
        async (db) => {
          const freshRun = await getWorkflowRun({ runId, resourceId }, { exclusiveLock: true, db });
          if (!freshRun) throw new WorkflowRunNotFoundError(runId);
          return updateWorkflowRun(
            {
              runId,
              resourceId,
              data: {
                timeline: merge(freshRun.timeline, {
                  [currentStepId]: {
                    output: data ?? {},
                    timestamp: new Date(),
                  },
                }),
              },
            },
            db,
          );
        },
        this.pool,
      );

      return this.triggerEvent({ runId, resourceId, eventName: timeoutEvent });
    }

    // waitFor steps - trigger the event with data
    if (eventName) {
      return this.triggerEvent({ runId, resourceId, eventName, data: data ?? {} });
    }

    // delay/waitUntil steps - trigger the timeout event
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
    await this.ensureStarted();

    const run = await updateWorkflowRun(
      {
        runId,
        resourceId,
        data: {
          status: WorkflowStatus.CANCELLED,
          pauseReason: null,
        },
        expectedStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING, WorkflowStatus.PAUSED],
      },
      this.db,
    );

    if (!run) {
      throw new WorkflowRunNotFoundError(runId);
    }

    await this.promotePendingRuns(run.workflowId);

    this.logger.log(`${LOG_PREFIX} Cancelled workflow run ${runId}`);
    return run;
  }

  async getRun({
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  }): Promise<WorkflowRun> {
    await this.ensureStarted();

    const run = await getWorkflowRun({ runId, resourceId }, { db: this.db });

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

    const completedSteps = Object.values(run.timeline).filter(
      (entry): entry is { output: unknown; timestamp: Date } =>
        typeof entry === 'object' &&
        entry !== null &&
        'output' in entry &&
        entry.output !== undefined,
    ).length;

    // Without registered workflow definitions, total steps are unknown.
    // Use completed steps as best-effort estimate for in-progress runs.
    const totalSteps = run.status === WorkflowStatus.COMPLETED ? completedSteps : 0;
    const completionPercentage =
      run.status === WorkflowStatus.COMPLETED
        ? 100
        : run.status === WorkflowStatus.FAILED || run.status === WorkflowStatus.CANCELLED
          ? 0
          : 0;

    return {
      ...run,
      completedSteps,
      completionPercentage,
      totalSteps,
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
    await this.ensureStarted();

    if (workflowId) validateWorkflowId(workflowId);
    validateResourceId(resourceId);

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

  private async ensureStarted(): Promise<void> {
    if (!this._started) {
      await this.start();
    }
  }
}
