import { context, type Tracer, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * Build a fresh tracer + in-memory exporter for a single test.
 * Callers MUST invoke `teardown()` in `afterEach`.
 */
export function setupOtel(): {
  tracer: Tracer;
  getSpans: () => ReadableSpan[];
  getSpansByName: (name: string) => ReadableSpan[];
  teardown: () => Promise<void>;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // AsyncHooks context manager is required for nested step spans to attach
  // to the workflow.run span across `await` boundaries. We register it
  // globally because OTel's context API reads from the global manager.
  const contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);

  const tracer = provider.getTracer('pg-workflows-test');

  return {
    tracer,
    getSpans: () => exporter.getFinishedSpans(),
    getSpansByName: (name: string) => exporter.getFinishedSpans().filter((s) => s.name === name),
    teardown: async () => {
      await provider.shutdown();
      contextManager.disable();
      context.disable();
      trace.disable();
    },
  };
}
