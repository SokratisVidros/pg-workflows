import type { StandardSchemaV1 } from '@standard-schema/spec';

export class WorkflowEngineError extends Error {
  constructor(
    message: string,
    public readonly workflowId?: string,
    public readonly runId?: string,
    public override readonly cause: Error | undefined = undefined,
    public readonly issues?: StandardSchemaV1.FailureResult['issues'] | undefined,
  ) {
    super(message);
    this.name = 'WorkflowEngineError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkflowEngineError);
    }
  }
}

export class WorkflowRunNotFoundError extends WorkflowEngineError {
  constructor(runId?: string, workflowId?: string) {
    super('Workflow run not found', workflowId, runId);
    this.name = 'WorkflowRunNotFoundError';
  }
}
