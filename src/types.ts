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

export type Parameters = z.ZodTypeAny;
export type inferParameters<P extends Parameters> = P extends z.ZodTypeAny ? z.infer<P> : never;

export type ScheduleContext = {
  timestamp: Date;
  lastTimestamp: Date | undefined;
  timezone: string;
};

export type CronConfig = {
  expression: string;
  timezone?: string;
};

export type WorkflowOptions<I extends Parameters> = {
  timeout?: number;
  retries?: number;
  inputSchema?: I;
  cron?: string | CronConfig;
};

export interface WorkflowLogger {
  log(message: string): void;
  error(message: string, ...args: unknown[]): void;
}

export type InternalWorkflowLoggerContext = {
  runId?: string;
  workflowId?: string;
};
export interface InternalWorkflowLogger {
  log(message: string, context?: InternalWorkflowLoggerContext): void;
  error(message: string, error: Error, context?: InternalWorkflowLoggerContext): void;
}

export type StepContext = {
  run: <T>(stepId: string, handler: () => Promise<T>) => Promise<T>;
  waitFor: <T extends Parameters>(
    stepId: string,
    { eventName, timeout, schema }: { eventName: string; timeout?: number; schema?: T },
  ) => Promise<inferParameters<T>>;
  waitUntil: (stepId: string, { date }: { date: Date }) => Promise<void>;
  pause: (stepId: string) => Promise<void>;
};

export type WorkflowContext<T extends Parameters = Parameters> = {
  input: T;
  step: StepContext;
  workflowId: string;
  runId: string;
  timeline: Record<string, unknown>;
  logger: WorkflowLogger;
  schedule?: ScheduleContext;
};

export type WorkflowDefinition<T extends Parameters = Parameters> = {
  id: string;
  handler: (context: WorkflowContext<inferParameters<T>>) => Promise<unknown>;
  inputSchema?: T;
  timeout?: number; // milliseconds
  retries?: number;
  cron?: CronConfig;
};

export type InternalStepDefinition = {
  id: string;
  type: StepType;
  conditional: boolean;
  loop: boolean;
  isDynamic: boolean;
};

export type InternalWorkflowDefinition<T extends Parameters = Parameters> =
  WorkflowDefinition<T> & {
    steps: InternalStepDefinition[];
  };

export type WorkflowRunProgress = WorkflowRun & {
  completionPercentage: number;
  totalSteps: number;
  completedSteps: number;
};
