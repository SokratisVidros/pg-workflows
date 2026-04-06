import { WorkflowEngine, type WorkflowRunProgress, workflow } from 'pg-workflows';
import { z } from 'zod';

// 1. Define a workflow
const approvalWorkflow = workflow(
  'approval-workflow',
  async ({ step, input }) => {
    const draft = await step.run('create-draft', async () => {
      console.log(`Creating draft for ${input.title}...`);
      return { id: 'draft_1', title: input.title, content: 'This is a draft document!' };
    });

    const approval = await step.waitFor('wait-approval', {
      eventName: 'approved',
      timeout: 60000,
      schema: z.object({ approved: z.boolean() }),
    });

    await step.run('publish', async () => {
      console.log(`Publishing draft ${draft?.id} with approval:`, approval);
      return { published: true };
    });

    return { draftId: draft?.id, status: 'published', approvedBy: approval?.approved };
  },
  {
    inputSchema: z.object({ title: z.string() }),
  },
);

// 2. Start the engine
async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const engine = new WorkflowEngine({
    connectionString: DATABASE_URL,
    workflows: [approvalWorkflow],
  });

  await engine.start();

  // 3. Run the workflow
  const run = await engine.startWorkflow({
    workflowId: 'approval-workflow',
    resourceId: 'tenant_1',
    input: { title: 'My Document' },
  });

  await new Promise((r) => setTimeout(r, 2000));

  await engine.triggerEvent({
    runId: run.id,
    resourceId: 'tenant_1',
    eventName: 'approved',
    data: { approvedBy: 'admin', approvedAt: new Date() },
  });

  // 4. Poll for completion
  let progress: WorkflowRunProgress;

  do {
    await new Promise((r) => setTimeout(r, 1000));
    progress = await engine.checkProgress({
      runId: run.id,
      resourceId: 'tenant_1',
    });
    console.log(
      `Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps)`,
    );
  } while (progress.status === 'running' || progress.status === 'paused');

  await engine.stop();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
