import type { SendOptions } from 'pg-boss';

/**
 * Per-job pg-boss send options we expose on start/resume/trigger.
 * Picked from {@link SendOptions}: retry, expiration, retention, and heartbeat.
 * @see https://pgboss.io/api/jobs#send
 */
export type WorkflowJobSendOptions = Pick<
  SendOptions,
  | 'retryLimit'
  | 'retryDelay'
  | 'retryBackoff'
  | 'retryDelayMax'
  | 'expireInSeconds'
  | 'retentionSeconds'
  | 'deleteAfterSeconds'
  | 'heartbeatSeconds'
>;

export const defaultExpireInSeconds: number = process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS
  ? Number.parseInt(process.env.WORKFLOW_RUN_EXPIRE_IN_SECONDS, 10)
  : 5 * 60; // 5 minutes

/**
 * Resolves maxRetries / retryLimit: explicit `retryLimit`, then deprecated `retries` alias, then fallback.
 */
export const resolveMaxRetries = (
  options?: Pick<WorkflowJobSendOptions, 'retryLimit'> & { retries?: number },
  fallback = 0,
): number => options?.retryLimit ?? options?.retries ?? fallback;

/**
 * Builds pg-boss send options for a workflow-run job.
 * Defaults match the library today: expire from env/300s, retryBackoff + retryDelay 1,
 * retryLimit from the run's maxRetries (or options).
 */
export const resolveJobSendOptions = (
  maxRetries: number,
  options?: WorkflowJobSendOptions & { retries?: number },
): WorkflowJobSendOptions => {
  const resolved: WorkflowJobSendOptions = {
    expireInSeconds: options?.expireInSeconds ?? defaultExpireInSeconds,
    retryLimit: resolveMaxRetries(options, maxRetries),
    retryBackoff: options?.retryBackoff ?? true,
    retryDelay: options?.retryDelay ?? 1,
  };

  if (options?.retryDelayMax !== undefined) {
    resolved.retryDelayMax = options.retryDelayMax;
  }
  if (options?.retentionSeconds !== undefined) {
    resolved.retentionSeconds = options.retentionSeconds;
  }
  if (options?.deleteAfterSeconds !== undefined) {
    resolved.deleteAfterSeconds = options.deleteAfterSeconds;
  }
  if (options?.heartbeatSeconds !== undefined) {
    resolved.heartbeatSeconds = options.heartbeatSeconds;
  }

  return resolved;
};
