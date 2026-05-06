import type { InferInputParameters, InputParameters, WorkflowFlowControl } from './types';

export type ResolvedFlowControl =
  | {
      type: 'concurrency';
      concurrencyKey: string;
      concurrencyLimit: number;
    }
  | {
      type: 'singleton';
      concurrencyKey: string;
      singletonMode: 'skip' | 'cancel';
    }
  | null;

export function assertValidFlowControl(
  flowControl: WorkflowFlowControl | undefined,
  owner: string,
): void {
  if (flowControl?.concurrency && flowControl.singleton) {
    throw new Error(
      `${owner} cannot define both flowControl.concurrency and flowControl.singleton`,
    );
  }
}

export function resolveFlowControl<I extends InputParameters>(
  flowControl: WorkflowFlowControl<I> | undefined,
  input: InferInputParameters<I>,
): ResolvedFlowControl {
  if (!flowControl) {
    return null;
  }

  if (flowControl.concurrency) {
    const resolved = flowControl.concurrency(input);
    const key = resolved?.key?.trim();

    if (!key) {
      throw new Error('flowControl.concurrency must return a non-empty key');
    }

    if (
      !Number.isInteger(resolved.limit) ||
      typeof resolved.limit !== 'number' ||
      resolved.limit < 1
    ) {
      throw new Error('flowControl.concurrency must return a positive integer limit');
    }

    return {
      type: 'concurrency',
      concurrencyKey: key,
      concurrencyLimit: resolved.limit,
    };
  }

  if (flowControl.singleton) {
    const resolved = flowControl.singleton(input);
    const key = resolved?.key?.trim();

    if (!key) {
      throw new Error('flowControl.singleton must return a non-empty key');
    }

    if (resolved.mode !== 'skip' && resolved.mode !== 'cancel') {
      throw new Error("flowControl.singleton must return mode 'skip' or 'cancel'");
    }

    return {
      type: 'singleton',
      concurrencyKey: key,
      singletonMode: resolved.mode,
    };
  }

  return null;
}
