import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { WorkflowEngine, workflow } from 'pg-workflows';

// 1. Define a workflow
const onboardUser = workflow('onboard-user', async ({ step, input }) => {
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
});

// 2. Start the engine
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const boss = new PgBoss({ db: { executeSql: (text, values) => pool.query(text, values) } });

const engine = new WorkflowEngine({
  boss,
  workflows: [onboardUser],
});

await engine.start();

// 3. Run the workflow
const run = await engine.startWorkflow({
  workflowId: 'onboard-user',
  resourceId: 'tenant_1',
  input: { email: 'alice@example.com' },
});

console.log('Workflow started:', run.id);

// 4. Poll for completion
let progress = await engine.checkProgress({ runId: run.id, resourceId: 'tenant_1' });

while (progress.status === 'running') {
  await new Promise((r) => setTimeout(r, 1000));
  progress = await engine.checkProgress({ runId: run.id, resourceId: 'tenant_1' });
  console.log(
    `Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps)`,
  );
}

console.log('Workflow finished:', progress.status, progress.output);

await engine.stop();
await pool.end();
