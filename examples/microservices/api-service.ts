/**
 * API Service — lightweight process that starts and manages workflows.
 *
 * Imports only from `pg-workflows/client` — no handler code, no AST parser,
 * no heavy worker dependencies. In a real app this would be your Express,
 * Fastify, or Hono server.
 */
import { WorkflowClient, WorkflowStatus } from 'pg-workflows/client';
import { onboardUser } from './shared/workflows';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

async function main() {
  const client = new WorkflowClient({ connectionString: DATABASE_URL });
  await client.start();

  // Start a workflow using the typed ref — input is validated against the schema
  const run = await client.startWorkflow(onboardUser, {
    email: 'alice@example.com',
    name: 'Alice',
  });
  console.log(`Started workflow run: ${run.id}`);

  // Poll for progress
  let status = run.status;
  while (status === WorkflowStatus.RUNNING || status === WorkflowStatus.PENDING) {
    await new Promise((r) => setTimeout(r, 2000));
    const current = await client.getRun({ runId: run.id });
    status = current.status;
    console.log(`Status: ${status}`);
  }

  // Query completed run
  const result = await client.getRun({ runId: run.id });
  console.log('Final result:', result.output);

  await client.stop();
}

main().catch((err) => {
  console.error('API service failed:', err);
  process.exit(1);
});
