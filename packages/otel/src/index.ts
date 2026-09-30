import {
  type AttributeValue,
  context as otelContext,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import {
  isStepCached,
  type StepBaseContext,
  type WorkflowContext,
  type WorkflowPlugin,
} from 'pg-workflows';

export type OtelPluginOptions = {
  /** Tracer to use. Defaults to `trace.getTracer('pg-workflows')`. */
  tracer?: Tracer;
  /** Prefix for all span names. Defaults to `pg_workflows`. */
  spanNamePrefix?: string;
  /** Extra attributes merged onto the workflow.run span. */
  attributes?: (context: WorkflowContext) => Record<string, AttributeValue>;
};

type StepKind =
  | 'run'
  | 'waitFor'
  | 'delay'
  | 'waitUntil'
  | 'pause'
  | 'poll'
  | 'invokeChildWorkflow';

type TraceOptions = {
  /** Trace even when the step is replayed from the timeline (poll re-evaluates every time). */
  traceCached?: boolean;
  /** Return false to emit no span for a result (e.g. a step skipped on a paused run). */
  shouldEmit?: (result: unknown) => boolean;
};

function recordError(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

export function otelPlugin(
  options: OtelPluginOptions = {},
): WorkflowPlugin<StepBaseContext, object> {
  const tracer = options.tracer ?? trace.getTracer('pg-workflows');
  const prefix = options.spanNamePrefix ?? 'pg_workflows';

  return {
    name: 'opentelemetry',

    methods: (step, context) => {
      // Capture the active context (workflow.run span) and the start time
      // BEFORE running the step, but only materialise the span once the step
      // has run or thrown, so `shouldEmit` can suppress it.
      const traceStep = async <R>(
        kind: StepKind,
        stepId: string,
        fn: () => Promise<R>,
        { traceCached = false, shouldEmit }: TraceOptions = {},
      ): Promise<R> => {
        if (!traceCached && isStepCached(context.timeline, stepId)) {
          return fn();
        }
        const parentCtx = otelContext.active();
        const startTime = new Date();
        const startSpan = () =>
          tracer.startSpan(
            `${prefix}.step.${kind}`,
            { startTime, attributes: { 'step.id': stepId, 'step.type': kind } },
            parentCtx,
          );

        let result: R;
        try {
          result = await fn();
        } catch (err) {
          const span = startSpan();
          recordError(span, err);
          span.end();
          throw err;
        }
        if (!shouldEmit || shouldEmit(result)) {
          const span = startSpan();
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        }
        return result;
      };

      const traced =
        <Args extends unknown[], R>(
          kind: StepKind,
          base: (stepId: string, ...args: Args) => Promise<R>,
          traceOptions?: TraceOptions,
        ) =>
        (stepId: string, ...args: Args): Promise<R> =>
          traceStep(kind, stepId, () => base(stepId, ...args), traceOptions);

      const delay = traced('delay', step.delay) as StepBaseContext['delay'];

      return {
        run: traced('run', step.run, {
          shouldEmit: (result) => result !== undefined,
        }) as StepBaseContext['run'],
        waitFor: traced('waitFor', step.waitFor) as StepBaseContext['waitFor'],
        delay,
        sleep: delay,
        waitUntil: traced('waitUntil', step.waitUntil) as StepBaseContext['waitUntil'],
        pause: traced('pause', step.pause) as StepBaseContext['pause'],
        poll: traced('poll', step.poll, { traceCached: true }) as StepBaseContext['poll'],
        invokeChildWorkflow: traced(
          'invokeChildWorkflow',
          step.invokeChildWorkflow as (stepId: string, ...args: unknown[]) => Promise<unknown>,
        ) as StepBaseContext['invokeChildWorkflow'],
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
            ...(options.attributes ? options.attributes(context) : {}),
          },
        },
        async (span) => {
          try {
            const result = await next();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            recordError(span, err);
            throw err;
          } finally {
            span.end();
          }
        },
      ),
  };
}
