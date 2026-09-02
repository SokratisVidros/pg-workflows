import { WorkflowEngine, type WorkflowRunProgress, workflow } from 'pg-workflows';
import { z } from 'zod';

// 1. Define a workflow
const onboardUser = workflow(
  'onboard-user',
  async ({ step, input }) => {
    const user = await step.run('create-account', async () => {
      console.log(`Creating account for ${input.email}...`);
      return { id: 'usr_123', email: input.email };
    });

    await step.run('send-welcome-email', async () => {
      console.log(`Sending welcome email to ${user?.email}...`);
      return { sent: true };
    });

    await step.run('provision-resources', async () => {
      console.log(`Provisioning resources for user ${user?.id}...`);
      return { provisioned: true };
    });

    return { userId: user?.id, status: 'onboarded' };
  },
  {
    inputSchema: z.object({ email: z.string() }),
  },
);

// 2. Start the engine
async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const engine = new WorkflowEngine({
    connectionString: DATABASE_URL,
    workflows: [onboardUser],
  });

  await engine.start();

  // 3. Run the workflow
  const run = await engine.startWorkflow({
    workflowId: 'onboard-user',
    resourceId: 'tenant_1',
    input: { email: 'alice@example.com' },
  });

  // 4. Poll for completion
  let progress: WorkflowRunProgress;

  do {
    await new Promise((r) => setTimeout(r, 1000));
    progress = await engine.checkProgress({ runId: run.id, resourceId: 'tenant_1' });
    console.log(
      `Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps)`,
    );
  } while (progress.status === 'running');

  await engine.stop();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
