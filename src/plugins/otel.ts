import type { Tracer } from '@opentelemetry/api';
import type { StepBaseContext, WorkflowContext, WorkflowPlugin } from '../types';

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer;
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string;
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, string | number | boolean>;
};

const DEFAULT_PREFIX = 'pg_workflows';

export function otelPlugin(
  _options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  return {
    name: 'opentelemetry',
    methods: () => ({}),
  };
}
