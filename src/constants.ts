export const PAUSE_EVENT_NAME = '__internal_pause';
export const WORKFLOW_RUN_QUEUE_NAME = 'workflow-run';
export const WORKFLOW_RUN_DLQ_QUEUE_NAME = 'workflow_run_dlq';
export const DEFAULT_PGBOSS_SCHEMA = 'pgboss_v12_pgworkflow';
export const MAX_WORKFLOW_ID_LENGTH = 256;
export const MAX_RESOURCE_ID_LENGTH = 256;

// Per-step timeline key suffixes. The shared helpers below are the single
// source of truth for engine + client so timeline-shape changes only need to
// happen in one place.
export const INVOKE_CHILD_WORKFLOW_TIMELINE_SUFFIX = 'invoke-child-workflow';
export const WAIT_FOR_TIMELINE_SUFFIX = 'wait-for';
export const invokeChildWorkflowTimelineKey = (stepId: string) =>
  `${stepId}-${INVOKE_CHILD_WORKFLOW_TIMELINE_SUFFIX}`;
export const waitForTimelineKey = (stepId: string) => `${stepId}-${WAIT_FOR_TIMELINE_SUFFIX}`;

/**
 * Type guard for `${stepId}-invoke-child-workflow` timeline entries. Used by the
 * engine to dispatch invoke-aware behavior and by the client's resume /
 * fast-forward no-op guards. Centralizing this keeps the timeline shape
 * contract in one place.
 */
export const isInvokeChildWorkflowTimelineEntry = (
  entry: unknown,
): entry is { invokeChildWorkflow: { childRunId: string; childWorkflowId: string } } =>
  !!entry && typeof entry === 'object' && 'invokeChildWorkflow' in entry;
