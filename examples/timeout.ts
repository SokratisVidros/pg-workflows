import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { WorkflowEngine, type WorkflowRunProgress, workflow } from 'pg-workflows';

// Workflow that demonstrates waitFor timeout - when no event arrives, approval is undefined
const timeoutWorkflow = workflow('timeout-example', async ({ step, input }) => {
  const draft = await step.run('create-draft', async () => {
    console.log(`Creating draft for ${input.title}...`);
    return { id: 'draft_1', title: input.title, content: 'Draft document' };
  });

  const approval = await step.waitFor('wait-approval', {
    eventName: 'approved',
    timeout: 3000, // 3 seconds - we won't trigger the event, so this will time out
  });

  await step.run('publish', async () => {
    const timedOut = approval === undefined;
    console.log(`Publishing draft ${draft?.id} - timed out: ${timedOut}`);
    return { published: true, timedOut };
  });

  return {
    draftId: draft?.id,
    status: 'published',
    approvedBy: approval?.approved,
    timedOut: approval === undefined,
  };
});

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
  });

  const engine = new WorkflowEngine({
    boss,
    workflows: [timeoutWorkflow],
  });

  await engine.start();

  const run = await engine.startWorkflow({
    workflowId: 'timeout-example',
    resourceId: 'tenant_1',
    input: { title: 'Timeout Test Document' },
  });
  // Don't trigger the event - workflow will complete via waitFor timeout (3s)

  let progress: WorkflowRunProgress;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    progress = await engine.checkProgress({ runId: run.id, resourceId: 'tenant_1' });
    console.log(
      `Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps) - ${progress.status}`,
    );
  } while (progress.status === 'running' || progress.status === 'paused');

  console.log('Workflow completed via waitFor timeout. Output:', progress?.output);

  await engine.stop();
  await pool.end();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
