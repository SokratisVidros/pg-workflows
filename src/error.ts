import type { StandardSchemaV1 } from '@standard-schema/spec';
import { MAX_RESOURCE_ID_LENGTH, MAX_WORKFLOW_ID_LENGTH } from './constants';

export function validateWorkflowId(workflowId: string): void {
  if (workflowId.length > MAX_WORKFLOW_ID_LENGTH) {
    throw new WorkflowEngineError(
      `workflowId exceeds maximum length of ${MAX_WORKFLOW_ID_LENGTH} characters (got ${workflowId.length})`,
      workflowId,
    );
  }
}

export function validateResourceId(resourceId: string | undefined | null): void {
  if (resourceId != null && resourceId.length > MAX_RESOURCE_ID_LENGTH) {
    throw new WorkflowEngineError(
      `resourceId exceeds maximum length of ${MAX_RESOURCE_ID_LENGTH} characters (got ${resourceId.length})`,
    );
  }
}

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
