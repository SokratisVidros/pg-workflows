# GitHub Copilot Instructions - pg-workflows

## What is pg-workflows?

pg-workflows is a TypeScript workflow engine that uses PostgreSQL for durable execution, event-driven orchestration, and automatic retries. No extra infrastructure beyond PostgreSQL. Built on pg-boss.

## Code Conventions

- **Linter/Formatter:** Biome (not ESLint/Prettier)
- **Test framework:** Vitest
- **Build tool:** bunup
- **Module system:** ESM-first with CJS compatibility
- **Validation:** Zod for input schemas
- **IDs:** KSUID for workflow run IDs
- **No semicolons** - follow the existing Biome config

## Core API Quick Reference

### Define a workflow

```typescript
import { workflow } from 'pg-workflows';
import { z } from 'zod';

const myWorkflow = workflow(
  'workflow-id',
  async ({ step, input }) => {
    const result = await step.run('step-1', async () => {
      return { processed: input.data };
    });
    return result;
  },
  {
    inputSchema: z.object({ data: z.string() }),
    timeout: 60000,
    retries: 3,
  }
);
```

### Create and start the engine

```typescript
import { WorkflowEngine } from 'pg-workflows';
import PgBoss from 'pg-boss';  // peer dependency - user installs separately

const engine = new WorkflowEngine({
  boss: new PgBoss({ connectionString: process.env.DATABASE_URL }),
  workflows: [myWorkflow],
});
await engine.start();
```

### Step types

- `step.run(stepId, handler)` - Durable step, runs exactly once, result persisted in PostgreSQL.
- `step.waitFor(stepId, { eventName, timeout?, schema? })` - Pause and wait for an external event.
- `step.pause(stepId)` - Manually pause; resume with `engine.resumeWorkflow()`.
- `step.waitUntil(stepId, { date })` - Wait until a date *(not yet implemented)*.

### Engine methods

- `engine.startWorkflow({ workflowId, resourceId?, input, options? })` - Start a new run.
- `engine.pauseWorkflow({ runId, resourceId? })` - Pause a run.
- `engine.resumeWorkflow({ runId, resourceId? })` - Resume a paused run.
- `engine.cancelWorkflow({ runId, resourceId? })` - Cancel a run.
- `engine.triggerEvent({ runId, resourceId?, eventName, data? })` - Send event to a waiting workflow.
- `engine.getRun({ runId, resourceId? })` - Get run details.
- `engine.checkProgress({ runId, resourceId? })` - Get progress (completionPercentage, completedSteps, totalSteps).
- `engine.getRuns({ resourceId?, statuses?, workflowId?, limit?, startingAfter? })` - List runs with cursor pagination.

### Key types

```typescript
enum WorkflowStatus { PENDING, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED }
enum StepType { PAUSE, RUN, WAIT_FOR, WAIT_UNTIL }
```

### Error handling

- `WorkflowEngineError` - Base error class with optional `workflowId`, `runId`, `cause`.
- `WorkflowRunNotFoundError` - Thrown when a run ID doesn't exist.

## AI & Agent Workflows

pg-workflows is ideal for AI agents and LLM pipelines. Key patterns:

- **Multi-step agents** - Each LLM call is a durable `step.run()`. If the process crashes, the agent resumes from the last completed step without re-running expensive calls.
- **Human-in-the-loop** - Use `step.waitFor('review', { eventName: 'human-reviewed' })` to pause for human review/approval. Zero resource consumption while waiting.
- **RAG pipelines** - Chain embed → search → generate → validate as discrete steps. Each result is cached in PostgreSQL.
- **Tool-use agents** - Each tool invocation is a `step.run()` with a unique ID. Results survive crashes and retries.

```typescript
const agent = workflow('ai-agent', async ({ step, input }) => {
  const plan = await step.run('plan', async () => {
    return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: input.prompt }] });
  });
  for (const task of plan.tasks) {
    await step.run(`task-${task.id}`, async () => {
      return await llm.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: task.description }] });
    });
  }
}, { retries: 3, timeout: 30 * 60 * 1000 });
```

## Important Patterns

- Step IDs must be unique within a workflow. Use dynamic IDs in loops: `` step.run(`process-${item.id}`, ...) ``
- Step results are cached - on retry, completed steps return persisted results.
- `resourceId` is optional, used for multi-tenant scoping.
- Workflow handlers are statically analyzed at registration to extract step definitions.
- Migrations run automatically on `engine.start()`.
- Retry logic uses exponential backoff: `2^retryCount * 1000ms`.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `WORKFLOW_RUN_WORKERS` - Number of workers (default: 3)
- `WORKFLOW_RUN_EXPIRE_IN_SECONDS` - Job expiration (default: 300)
