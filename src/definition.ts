import { assertValidFlowControl } from './flow-control';
import type {
  InputParameters,
  StepBaseContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowFactory,
  WorkflowFlowControl,
  WorkflowOptions,
  WorkflowPlugin,
  WorkflowRef,
  WorkflowRefOptions,
} from './types';

/**
 * Create a lightweight workflow reference.
 * Safe to import from `pg-workflows/client` - no engine or handler code.
 */
export function createWorkflowRef<
  TOutput = unknown,
  TInput extends InputParameters = InputParameters,
>(id: string, options?: WorkflowRefOptions<TInput>): WorkflowRef<TInput, TOutput> {
  assertValidFlowControl(
    options?.flowControl as WorkflowFlowControl | undefined,
    `WorkflowRef "${id}"`,
  );

  const ref = ((
    handler: (context: WorkflowContext<TInput, StepBaseContext>) => Promise<unknown>,
    defineOptions?: Omit<WorkflowOptions<TInput>, 'inputSchema' | 'flowControl'>,
  ): WorkflowDefinition<TInput> => ({
    id,
    handler: handler as (
      context: WorkflowContext<InputParameters, StepBaseContext>,
    ) => Promise<unknown>,
    inputSchema: options?.inputSchema,
    flowControl: options?.flowControl,
    timeout: defineOptions?.timeout,
    retries: defineOptions?.retries,
  })) as WorkflowRef<TInput, TOutput>;

  Object.defineProperty(ref, 'id', { value: id, enumerable: true });
  Object.defineProperty(ref, 'inputSchema', {
    value: options?.inputSchema,
    enumerable: true,
  });
  Object.defineProperty(ref, 'flowControl', {
    value: options?.flowControl,
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
    { inputSchema, timeout, retries, flowControl }: WorkflowOptions<I> = {},
  ): WorkflowDefinition<I> => ({
    id,
    handler: handler as (
      context: WorkflowContext<InputParameters, StepBaseContext>,
    ) => Promise<unknown>,
    inputSchema,
    flowControl,
    timeout,
    retries,
    plugins: plugins.length > 0 ? (plugins as WorkflowPlugin[]) : undefined,
  })) as WorkflowFactory<TStepExt>;

  const wrappedFactory = ((id, handler, options = {}) => {
    assertValidFlowControl(
      options.flowControl as WorkflowFlowControl | undefined,
      `workflow("${id}")`,
    );

    return factory(id, handler, options);
  }) as WorkflowFactory<TStepExt>;

  wrappedFactory.use = <TNewExt>(
    plugin: WorkflowPlugin<StepBaseContext & TStepExt, TNewExt>,
  ): WorkflowFactory<TStepExt & TNewExt> =>
    createWorkflowFactory<TStepExt & TNewExt>([
      ...plugins,
      plugin as WorkflowPlugin<unknown, object>,
    ]);

  wrappedFactory.ref = createWorkflowRef;

  return wrappedFactory;
}

export const workflow: WorkflowFactory = createWorkflowFactory();
