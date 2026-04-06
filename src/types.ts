import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { WorkflowRun } from './db/types';
import type { Duration } from './duration';

export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum StepType {
  PAUSE = 'pause',
  RUN = 'run',
  WAIT_FOR = 'waitFor',
  WAIT_UNTIL = 'waitUntil',
  DELAY = 'delay',
  POLL = 'poll',
}

export type InputParameters = StandardSchemaV1;
export type InferInputParameters<P extends InputParameters> = StandardSchemaV1.InferOutput<P>;

export type WorkflowOptions<I extends InputParameters> = {
  timeout?: number;
  retries?: number;
  inputSchema?: I;
};

export type StepBaseContext = {
  run: <T>(stepId: string, handler: () => Promise<T>) => Promise<T>;
  waitFor: {
    <T extends InputParameters>(
      stepId: string,
      options: { eventName: string; schema?: T },
    ): Promise<InferInputParameters<T>>;
    <T extends InputParameters>(
      stepId: string,
      options: { eventName: string; timeout: number; schema?: T },
    ): Promise<InferInputParameters<T> | undefined>;
  };
  waitUntil: {
    (stepId: string, date: Date): Promise<void>;
    (stepId: string, dateString: string): Promise<void>;
    (stepId: string, options: { date: Date | string }): Promise<void>;
  };
  /** Delay execution for a duration (sugar over waitUntil). Alias: sleep. */
  delay: (stepId: string, duration: Duration) => Promise<void>;
  /** Alias for delay. */
  sleep: (stepId: string, duration: Duration) => Promise<void>;
  pause: (stepId: string) => Promise<void>;
  poll: <T>(
    stepId: string,
    conditionFn: () => Promise<T | false>,
    options?: { interval?: Duration; timeout?: Duration },
  ) => Promise<{ timedOut: false; data: T } | { timedOut: true }>;
};

/**
 * Plugin that extends the workflow step API with extra methods.
 * @template TStepBase - The step type this plugin receives (base + previous plugins).
 * @template TStepExt - The extra methods this plugin adds to step.
 */
export interface WorkflowPlugin<TStepBase = StepBaseContext, TStepExt = object> {
  name: string;
  methods: (step: TStepBase) => TStepExt;
}

export type WorkflowContext<
  TInput extends InputParameters = InputParameters,
  TStep extends StepBaseContext = StepBaseContext,
> = {
  input: InferInputParameters<TInput>;
  step: TStep;
  workflowId: string;
  runId: string;
  timeline: Record<string, unknown>;
  logger: WorkflowLogger;
};

export type WorkflowDefinition<TInput extends InputParameters = InputParameters> = {
  id: string;
  /** Widest context avoids contravariance when collecting definitions; `workflow()` still types the handler narrowly. */
  handler: (context: WorkflowContext<InputParameters, StepBaseContext>) => Promise<unknown>;
  inputSchema?: TInput;
  timeout?: number; // milliseconds
  retries?: number;
  plugins?: WorkflowPlugin[];
};

export type StepInternalDefinition = {
  id: string;
  type: StepType;
  conditional: boolean;
  loop: boolean;
  isDynamic: boolean;
};

export type WorkflowInternalDefinition<TInput extends InputParameters = InputParameters> =
  WorkflowDefinition<TInput> & {
    steps: StepInternalDefinition[];
  };

/**
 * Chainable workflow factory: call as (id, handler, options) and/or use .use(plugin).
 * TStepExt is the accumulated step extension from all plugins (step = StepContext & TStepExt).
 */
export interface WorkflowFactory<TStepExt = object> {
  <I extends InputParameters = InputParameters>(
    id: string,
    handler: (context: WorkflowContext<I, StepBaseContext & TStepExt>) => Promise<unknown>,
    options?: WorkflowOptions<I>,
  ): WorkflowDefinition<I>;
  use<TNewExt>(
    plugin: WorkflowPlugin<StepBaseContext & TStepExt, TNewExt>,
  ): WorkflowFactory<TStepExt & TNewExt>;
  ref<TInput extends InputParameters = InputParameters>(
    id: string,
    options?: { inputSchema?: TInput },
  ): WorkflowRef<TInput>;
}

/**
 * Lightweight workflow reference — carries the workflow ID and input type
 * but no handler code. Safe to import in API services without pulling in
 * heavy worker dependencies.
 *
 * Callable: pass a handler to create a full WorkflowDefinition.
 */
export interface WorkflowRef<TInput extends InputParameters = InputParameters> {
  (
    handler: (context: WorkflowContext<TInput, StepBaseContext>) => Promise<unknown>,
    options?: Omit<WorkflowOptions<TInput>, 'inputSchema'>,
  ): WorkflowDefinition<TInput>;
  readonly id: string;
  readonly inputSchema?: TInput;
}

export type WorkflowRunProgress = WorkflowRun & {
  completionPercentage: number;
  totalSteps: number;
  completedSteps: number;
};

export interface WorkflowLogger {
  log(message: string): void;
  error(message: string, ...args: unknown[]): void;
}

export type WorkflowInternalLoggerContext = {
  runId?: string;
  workflowId?: string;
};
export interface WorkflowInternalLogger {
  log(message: string, context?: WorkflowInternalLoggerContext): void;
  error(message: string, error: Error, context?: WorkflowInternalLoggerContext): void;
}
