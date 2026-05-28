export type WorkflowRun = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  resourceId: string | null;
  workflowId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  input: unknown;
  output: unknown | null;
  error: string | null;
  currentStepId: string;
  timeline: Record<string, unknown>;
  pausedAt: Date | null;
  resumedAt: Date | null;
  completedAt: Date | null;
  timeoutAt: Date | null;
  retryCount: number;
  maxRetries: number;
  jobId: string | null;
  idempotencyKey: string | null;
  parentRunId: string | null;
  parentStepId: string | null;
  parentResourceId: string | null;
  /** Set when the run was started by a recurring schedule; the timestamp the schedule fired. */
  scheduledAt: Date | null;
};
