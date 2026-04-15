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
export function createWorkflowRef<TInput extends InputParameters = InputParameters>(
  id: string,
  options?: { inputSchema?: TInput },
): WorkflowRef<TInput> {
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
  })) as WorkflowRef<TInput>;

  Object.defineProperty(ref, 'id', { value: id, enumerable: true });
  Object.defineProperty(ref, 'inputSchema', { value: options?.inputSchema, enumerable: true });

  return ref;
}

function createWorkflowFactory<TStepExt extends object = object>(
  plugins: Array<WorkflowPlugin<unknown, object>> = [],
): WorkflowFactory<TStepExt> {
  const factory = (<I extends InputParameters>(
    id: string,
    handler: (context: WorkflowContext<I, StepBaseContext & TStepExt>) => Promise<unknown>,
    { inputSchema, timeout, retries }: WorkflowOptions<I> = {},
  ): WorkflowDefinition<I> => ({
    id,
    handler: handler as (
      context: WorkflowContext<InputParameters, StepBaseContext>,
    ) => Promise<unknown>,
    inputSchema,
    timeout,
    retries,
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
