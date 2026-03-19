import type {
  InputParameters,
  StepBaseContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowFactory,
  WorkflowOptions,
  WorkflowPlugin,
} from './types';

function createWorkflowFactory<TStepExt extends object = object>(
  plugins: Array<WorkflowPlugin<unknown, object>> = [],
): WorkflowFactory<TStepExt> {
  const factory = (<I extends InputParameters>(
    id: string,
    handler: (context: WorkflowContext<I, StepBaseContext & TStepExt>) => Promise<unknown>,
    { inputSchema, timeout, retries, cron }: WorkflowOptions<I> = {},
  ): WorkflowDefinition<I, StepBaseContext & TStepExt> => ({
    id,
    handler,
    inputSchema,
    timeout,
    retries,
    cron: typeof cron === 'string' ? { expression: cron } : cron,
    plugins: plugins.length > 0 ? (plugins as WorkflowPlugin[]) : undefined,
  })) as WorkflowFactory<TStepExt>;

  factory.use = <TNewExt>(
    plugin: WorkflowPlugin<StepBaseContext & TStepExt, TNewExt>,
  ): WorkflowFactory<TStepExt & TNewExt> =>
    createWorkflowFactory<TStepExt & TNewExt>([
      ...plugins,
      plugin as WorkflowPlugin<unknown, object>,
    ]);

  return factory;
}

export const workflow: WorkflowFactory = createWorkflowFactory();
