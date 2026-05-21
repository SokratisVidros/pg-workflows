import { type AttributeValue, SpanStatusCode, type Tracer, trace } from '@opentelemetry/api';
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

export function otelPlugin(
  options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  const tracer = options.tracer ?? trace.getTracer('pg-workflows');
  const prefix = options.spanNamePrefix ?? DEFAULT_PREFIX;
  const extraAttrs = options.attributes;

  return {
    name: 'opentelemetry',

    methods: () => ({}),

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
          } finally {
            span.end();
          }
        },
      ),
  };
}
