import {
  type AttributeValue,
  context as otelContext,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
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

function isCachedHit(timeline: Record<string, unknown>, stepId: string): boolean {
  const entry = timeline[stepId];
  if (
    entry &&
    typeof entry === 'object' &&
    'output' in entry &&
    (entry as { output: unknown }).output !== undefined
  ) {
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

    methods: (step, context) => ({
      run: async <T>(stepId: string, handler: () => Promise<T>) => {
        if (isCachedHit(context.timeline, stepId)) {
          return step.run(stepId, handler);
        }

        // Capture the active context (workflow.run span) before the async step runs.
        // We emit the span only if the step actually ran (result !== undefined).
        // If the base step skips execution (workflow paused/cancelled), it returns
        // undefined and we suppress the span to avoid noise on replay paths.
        const capturedCtx = otelContext.active();
        let result: T | undefined;
        let thrownError: Error | undefined;

        try {
          result = await step.run(stepId, handler);
        } catch (err) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }

        if (result === undefined && !thrownError) {
          // Step was skipped (workflow is paused/cancelled/failed) — no span.
          return undefined as T;
        }

        // Step ran or threw — emit a span with correct parent.
        const span = tracer.startSpan(
          `${prefix}.step.run`,
          { attributes: { 'step.id': stepId, 'step.type': 'run' } },
          capturedCtx,
        );

        if (thrownError) {
          span.recordException(thrownError);
          span.setStatus({ code: SpanStatusCode.ERROR, message: thrownError.message });
          span.end();
          throw thrownError;
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result as T;
      },
    }),

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
