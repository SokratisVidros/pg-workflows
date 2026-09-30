# Observability

## Tracing

[`@pg-workflows/otel`](../packages/otel/README.md) adds OpenTelemetry spans for each workflow execution and each step:

```bash
npm install @pg-workflows/otel @opentelemetry/api @opentelemetry/sdk-node
```

```typescript
import { otelPlugin } from '@pg-workflows/otel'
import { workflow } from 'pg-workflows'

const tracedWorkflow = workflow.use(otelPlugin())
```

Define workflows with `tracedWorkflow` instead of `workflow`. The package README has a runnable quickstart, the span and attribute reference, and the current limitations.

## Run state

Every run's status, step outputs, and error are in `workflow_runs`. Query them from code:

| Method | Use |
|--------|-----|
| `getRun({ runId })` | Status, `output`, `error`, and the `timeline` of step results for one run |
| `checkProgress({ runId })` | Completed and total steps, and a percentage |
| `getRuns({ statuses, workflowId, resourceId })` | Lists runs, for example every failed run of one workflow |
| `getStats({ workflowId })` | Run counts per status |

See the [API reference](api-reference.md#queries).

## Dashboard

[`@pg-workflows/ui`](../packages/ui/README.md) is a React dashboard for browsing runs and step timelines. Try it against your database with:

```bash
npx @pg-workflows/ui --database-url=postgres://postgres:postgres@localhost:5432/postgres
```
