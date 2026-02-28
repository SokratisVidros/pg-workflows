import type {
  inferParameters,
  Parameters,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowOptions,
} from './types';

export function workflow<I extends Parameters>(
  id: string,
  handler: (context: WorkflowContext<inferParameters<I>>) => Promise<unknown>,
  { inputSchema, timeout, retries, cron }: WorkflowOptions<I> = {},
): WorkflowDefinition<I> {
  return {
    id,
    handler,
    inputSchema,
    timeout,
    retries,
    cron: typeof cron === 'string' ? { expression: cron } : cron,
  };
}
