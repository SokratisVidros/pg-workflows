import type { z } from 'zod';
import type { WorkflowRun } from './db/types';

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
}

export type InputParameters = z.ZodTypeAny;
export type InferInputParameters<P extends InputParameters> = P extends z.ZodTypeAny
  ? z.infer<P>
  : never;

export type WorkflowOptions<I extends InputParameters> = {
  timeout?: number;
  retries?: number;
  inputSchema?: I;
};

export type StepBaseContext = {
  run: <T>(stepId: string, handler: () => Promise<T>) => Promise<T>;
  waitFor: <T extends InputParameters>(
    stepId: string,
    { eventName, timeout, schema }: { eventName: string; timeout?: number; schema?: T },
  ) => Promise<InferInputParameters<T>>;
  waitUntil: (stepId: string, { date }: { date: Date }) => Promise<void>;
  pause: (stepId: string) => Promise<void>;
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

export type WorkflowDefinition<
  TInput extends InputParameters = InputParameters,
  TStep extends StepBaseContext = StepBaseContext,
> = {
  id: string;
  handler: (context: WorkflowContext<TInput, TStep>) => Promise<unknown>;
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

export type WorkflowInternalDefinition<
  TInput extends InputParameters = InputParameters,
  TStep extends StepBaseContext = StepBaseContext,
> = WorkflowDefinition<TInput, TStep> & {
  steps: StepInternalDefinition[];
};

/**
 * Chainable workflow factory: call as (id, handler, options) and/or use .use(plugin).
 * TStepExt is the accumulated step extension from all plugins (step = StepContext & TStepExt).
 */
export interface WorkflowFactory<TStepExt = object> {
  (
    id: string,
    handler: (
      context: WorkflowContext<InputParameters, StepBaseContext & TStepExt>,
    ) => Promise<unknown>,
    options?: WorkflowOptions<InputParameters>,
  ): WorkflowDefinition<InputParameters, StepBaseContext & TStepExt>;
  use<TNewExt>(
    plugin: WorkflowPlugin<StepBaseContext & TStepExt, TNewExt>,
  ): WorkflowFactory<TStepExt & TNewExt>;
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
