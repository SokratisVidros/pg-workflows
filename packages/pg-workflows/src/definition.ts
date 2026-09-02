import type {
  InputParameters,
  StepBaseContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowFactory,
  WorkflowOptions,
  WorkflowPlugin,
  WorkflowRef,
} from './types';

/**
 * Create a lightweight workflow reference.
 * Safe to import from `pg-workflows/client` - no engine or handler code.
 */
export function createWorkflowRef<
  TOutput = unknown,
  TInput extends InputParameters = InputParameters,
>(
  id: string,
  options?: { inputSchema?: TInput; singleton?: boolean },
): WorkflowRef<TInput, TOutput> {
  const ref = ((
    handler: (context: WorkflowContext<TInput, StepBaseContext>) => Promise<unknown>,
    defineOptions?: Omit<WorkflowOptions<TInput>, 'inputSchema'>,
  ): WorkflowDefinition<TInput> => ({
    id,
    handler: handler as (
      context: WorkflowContext<InputParameters, StepBaseContext>,
    ) => Promise<unknown>,
    inputSchema: options?.inputSchema,
    timeout: defineOptions?.timeout,
    retries: defineOptions?.retries,
    priority: defineOptions?.priority,
    singleton: defineOptions?.singleton ?? options?.singleton,
    schedule: defineOptions?.schedule,
    timezone: defineOptions?.timezone,
  })) as WorkflowRef<TInput, TOutput>;

  Object.defineProperty(ref, 'id', { value: id, enumerable: true });
  Object.defineProperty(ref, 'inputSchema', {
    value: options?.inputSchema,
    enumerable: true,
  });
  Object.defineProperty(ref, 'singleton', {
    value: options?.singleton,
    enumerable: true,
  });

  return ref;
}

function createWorkflowFactory<TStepExt extends object = object>(
  plugins: Array<WorkflowPlugin<unknown, object>> = [],
): WorkflowFactory<TStepExt> {
  const factory = (<I extends InputParameters>(
    id: string,
    handler: (context: WorkflowContext<I, StepBaseContext & TStepExt>) => Promise<unknown>,
    {
      inputSchema,
      timeout,
      retries,
      priority,
      singleton,
      schedule,
      timezone,
    }: WorkflowOptions<I> = {},
  ): WorkflowDefinition<I> => ({
    id,
    handler: handler as (
      context: WorkflowContext<InputParameters, StepBaseContext>,
    ) => Promise<unknown>,
    inputSchema,
    timeout,
    retries,
    priority,
    singleton,
    schedule,
    timezone,
    plugins: plugins.length > 0 ? (plugins as WorkflowPlugin[]) : undefined,
  })) as WorkflowFactory<TStepExt>;

  factory.use = <TNewExt>(
    plugin: WorkflowPlugin<StepBaseContext & TStepExt, TNewExt>,
  ): WorkflowFactory<TStepExt & TNewExt> =>
    createWorkflowFactory<TStepExt & TNewExt>([
      ...plugins,
      plugin as WorkflowPlugin<unknown, object>,
    ]);

  factory.ref = createWorkflowRef;

  return factory;
}

export const workflow: WorkflowFactory = createWorkflowFactory();
