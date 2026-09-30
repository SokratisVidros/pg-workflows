# Tracing with OpenTelemetry

`@pg-workflows/otel` emits one `pg_workflows.workflow.run` span per execution, plus a child span for each step (`pg_workflows.step.run`, `pg_workflows.step.waitFor`, and so on). Add it **only in the process that runs `WorkflowEngine` workers**: the monolith, or the worker service. Clients start runs but never execute steps, so there's nothing to trace there.

## 1. Find or add an OpenTelemetry SDK

The plugin creates spans through `@opentelemetry/api`, so it needs an SDK registered in the process, with an async context manager.

- **Already set up** (`@opentelemetry/sdk-node`, `@vercel/otel`, Sentry v8 or later, Honeycomb, or Datadog through its OTel API support): use that setup as it is. Only add the plugin in step 2.
- **None.** Ask the user where traces should go. Then install:

  ```bash
  npm install @pg-workflows/otel @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
  ```

  Start the SDK before anything else runs in the worker's entry point:

  ```typescript
  // src/tracing.ts
  import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
  import { NodeSDK } from '@opentelemetry/sdk-node'

  // Reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS from the env.
  export const sdk = new NodeSDK({ serviceName: 'workflow-worker', traceExporter: new OTLPTraceExporter() })
  sdk.start()
  ```

  Import `./tracing` as the first line of the entry point, and call `await sdk.shutdown()` after `engine.stop()` on shutdown. For a quick local check with no collector, use `new tracing.ConsoleSpanExporter()` (`import { NodeSDK, tracing } from '@opentelemetry/sdk-node'`).

If the SDK is already there, install only the plugin: `npm install @pg-workflows/otel`, plus `@opentelemetry/api` if it isn't already a direct dependency.

## 2. Create a traced workflow factory

```typescript
// src/workflows/traced.ts
import { otelPlugin } from '@pg-workflows/otel'
import { workflow } from 'pg-workflows'

export const tracedWorkflow = workflow.use(otelPlugin())
```

Options: `tracer` (default `trace.getTracer('pg-workflows')`), `spanNamePrefix` (default `'pg_workflows'`), and `attributes: (ctx) => ({ ... })` for extra attributes on the run span, for example `{ 'tenant.id': ctx.resourceId ?? 'none' }`.

## 3. Define workflows through it

**Monolith.** Replace `workflow(` with `tracedWorkflow(` in every definition. The signature is identical.

**Web app plus worker, and microservices.** Calling a ref with a handler (`helloRef(handler)`) builds a definition **without plugins**. In the worker, build each definition with the traced factory, reusing the ref's ID and schema:

```typescript
// src/workflows/definitions.ts
import { helloRef } from './refs'
import { tracedWorkflow } from './traced'

export const hello = tracedWorkflow(
  helloRef.id,
  async ({ step, input }) => {
    return step.run('build-greeting', async () => ({ message: `Hello, ${input.name}!` }))
  },
  { inputSchema: helloRef.inputSchema, singleton: helloRef.singleton, retries: 3 },
)
```

The API services keep using the refs unchanged.

## 4. Verify

Start a run and check the exporter, or the console with `ConsoleSpanExporter`. Expect a `pg_workflows.workflow.run` span with `workflow.id` and `workflow.run_id` attributes, and a `pg_workflows.step.run` child span for each step that returns a value.

Tell the user how these traces behave:

- A run that pauses (`waitFor`, `delay`, `pause`) and resumes produces **one trace per execution**. Correlate the traces with `workflow.run_id`.
- Replayed steps emit no span. A `step.run` that returns `undefined` emits no span either, so return a value from steps they want traced.
- Spans created inside a `step.run` callback, such as auto-instrumented HTTP or database calls, are children of the run span, not of the step span.
