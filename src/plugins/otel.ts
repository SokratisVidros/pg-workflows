import {
  type AttributeValue,
  context as otelContext,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { invokeChildWorkflowTimelineKey } from '../constants';
import type { StepBaseContext, WorkflowContext, WorkflowPlugin } from '../types';

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer;
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string;
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, AttributeValue>;
};

const DEFAULT_PREFIX = 'pg_workflows';

type StepKind =
  | 'run'
  | 'waitFor'
  | 'delay'
  | 'waitUntil'
  | 'pause'
  | 'poll'
  | 'invokeChildWorkflow';

export function isCachedHit(
  timeline: Record<string, unknown>,
  stepId: string,
  kind: StepKind,
): boolean {
  const entry = timeline[stepId];
  if (
    entry &&
    typeof entry === 'object' &&
    'output' in entry &&
    (entry as { output: unknown }).output !== undefined
  ) {
    return true;
  }
  if (kind === 'invokeChildWorkflow' && timeline[invokeChildWorkflowTimelineKey(stepId)]) {
    return true;
  }
  return false;
}

export function otelPlugin(
  options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  const tracer = options.tracer ?? trace.getTracer('pg-workflows');
  const prefix = options.spanNamePrefix ?? DEFAULT_PREFIX;
  const extraAttrs = options.attributes;

  return {
    name: 'opentelemetry',

    methods: (step, context) => {
      const wrapVoidish = <Args extends unknown[], R>(
        kind: 'waitFor' | 'delay' | 'waitUntil' | 'pause',
        base: (stepId: string, ...args: Args) => Promise<R>,
      ) => {
        return async (stepId: string, ...args: Args): Promise<R> => {
          if (isCachedHit(context.timeline, stepId, kind)) {
            return base(stepId, ...args);
          }
          const capturedCtx = otelContext.active();
          const startTime = new Date();
          let result: R;
          let originalErr: unknown;
          let thrownError: Error | undefined;
          try {
            result = await base(stepId, ...args);
          } catch (err) {
            originalErr = err;
            thrownError = err instanceof Error ? err : new Error(String(err));
          }
          const span = tracer.startSpan(
            `${prefix}.step.${kind}`,
            {
              startTime,
              attributes: { 'step.id': stepId, 'step.type': kind },
            },
            capturedCtx,
          );
          if (thrownError) {
            span.recordException(thrownError);
            span.setStatus({ code: SpanStatusCode.ERROR, message: thrownError.message });
            span.end();
            throw originalErr;
          }
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          // biome-ignore lint/style/noNonNullAssertion: result is assigned in try when not thrown
          return result!;
        };
      };

      return {
        run: async <T>(stepId: string, handler: () => Promise<T>) => {
          if (isCachedHit(context.timeline, stepId, 'run')) {
            return step.run(stepId, handler);
          }

          // Capture the active context (workflow.run span) and the start time
          // BEFORE running the step, so the emitted span has correct timing.
          // We materialise the span only if the step actually ran or threw —
          // skipped steps (engine short-circuit on paused/cancelled runs) return
          // undefined and produce no span.
          const capturedCtx = otelContext.active();
          const startTime = new Date();
          let result: T | undefined;
          let originalErr: unknown;
          let thrownError: Error | undefined;

          try {
            result = await step.run(stepId, handler);
          } catch (err) {
            originalErr = err;
            thrownError = err instanceof Error ? err : new Error(String(err));
          }

          if (result === undefined && !thrownError) {
            return undefined as T;
          }

          const span = tracer.startSpan(
            `${prefix}.step.run`,
            {
              startTime,
              attributes: { 'step.id': stepId, 'step.type': 'run' },
            },
            capturedCtx,
          );

          if (thrownError) {
            span.recordException(thrownError);
            span.setStatus({ code: SpanStatusCode.ERROR, message: thrownError.message });
            span.end();
            throw originalErr;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result as T;
        },
        waitFor: wrapVoidish('waitFor', step.waitFor as never) as StepBaseContext['waitFor'],
        delay: wrapVoidish('delay', step.delay as never) as StepBaseContext['delay'],
        sleep: wrapVoidish('delay', step.delay as never) as StepBaseContext['sleep'],
        waitUntil: wrapVoidish(
          'waitUntil',
          step.waitUntil as never,
        ) as StepBaseContext['waitUntil'],
        pause: wrapVoidish('pause', step.pause as never) as StepBaseContext['pause'],
        poll: (async <T>(
          stepId: string,
          conditionFn: () => Promise<T | false>,
          pollOptions?: Parameters<StepBaseContext['poll']>[2],
        ) => {
          const capturedCtx = otelContext.active();
          const startTime = new Date();
          let result: Awaited<ReturnType<StepBaseContext['poll']>> | undefined;
          let originalErr: unknown;
          let thrownError: Error | undefined;
          try {
            result = await step.poll(stepId, conditionFn, pollOptions);
          } catch (err) {
            originalErr = err;
            thrownError = err instanceof Error ? err : new Error(String(err));
          }
          const span = tracer.startSpan(
            `${prefix}.step.poll`,
            {
              startTime,
              attributes: { 'step.id': stepId, 'step.type': 'poll' },
            },
            capturedCtx,
          );
          if (thrownError) {
            span.recordException(thrownError);
            span.setStatus({ code: SpanStatusCode.ERROR, message: thrownError.message });
            span.end();
            throw originalErr;
          }
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          // biome-ignore lint/style/noNonNullAssertion: result is assigned in try when not thrown
          return result!;
        }) as StepBaseContext['poll'],
        invokeChildWorkflow: (async (
          stepId: string,
          refOrParams: Parameters<StepBaseContext['invokeChildWorkflow']>[1],
          inputArg?: unknown,
          optionsArg?: unknown,
        ) => {
          if (isCachedHit(context.timeline, stepId, 'invokeChildWorkflow')) {
            return (step.invokeChildWorkflow as (...args: unknown[]) => Promise<unknown>)(
              stepId,
              refOrParams,
              inputArg,
              optionsArg,
            );
          }
          const capturedCtx = otelContext.active();
          const startTime = new Date();
          let result: unknown;
          let originalErr: unknown;
          let thrownError: Error | undefined;
          try {
            result = await (step.invokeChildWorkflow as (...args: unknown[]) => Promise<unknown>)(
              stepId,
              refOrParams,
              inputArg,
              optionsArg,
            );
          } catch (err) {
            originalErr = err;
            thrownError = err instanceof Error ? err : new Error(String(err));
          }
          const span = tracer.startSpan(
            `${prefix}.step.invokeChildWorkflow`,
            {
              startTime,
              attributes: { 'step.id': stepId, 'step.type': 'invokeChildWorkflow' },
            },
            capturedCtx,
          );
          if (thrownError) {
            span.recordException(thrownError);
            span.setStatus({ code: SpanStatusCode.ERROR, message: thrownError.message });
            span.end();
            throw originalErr;
          }
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        }) as StepBaseContext['invokeChildWorkflow'],
      };
    },

    wrap: (context, next) =>
      tracer.startActiveSpan(
        `${prefix}.workflow.run`,
        {
          attributes: {
            'workflow.id': context.workflowId,
            'workflow.run_id': context.runId,
            'workflow.attempt': context.attempt,
            ...(context.resourceId ? { 'workflow.resource_id': context.resourceId } : {}),
            ...(extraAttrs ? extraAttrs(context) : {}),
          },
        },
        async (span) => {
          try {
            const result = await next();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw err;
          } finally {
            span.end();
          }
        },
      ),
  };
}
