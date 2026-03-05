import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { WorkflowEngine, type WorkflowRunProgress, workflow } from 'pg-workflows';

// Simulate an external payment API
let paymentState: 'pending' | 'completed' = 'pending';

async function getPaymentStatus(paymentId: string) {
  console.log(`  [API] Checking payment ${paymentId}...`);
  return { completed: paymentState === 'completed', paymentId };
}

// Define a workflow that polls until a payment completes
const awaitPayment = workflow('await-payment', async ({ step, input }) => {
  await step.run('create-order', async () => {
    console.log(`Creating order ${input.orderId}...`);
    return { orderId: input.orderId, createdAt: new Date().toISOString() };
  });

  // Poll the payment API every 30s, give up after 2 minutes
  const result = await step.poll(
    'wait-for-payment',
    async () => {
      const status = await getPaymentStatus(input.paymentId);
      return status.completed ? status : false;
    },
    { interval: '30s', timeout: '2 minutes' },
  );

  if (result.timedOut) {
    await step.run('cancel-order', async () => {
      console.log(`Payment timed out, Cancelling order ${input.orderId}...`);
      return { cancelled: true };
    });
    return { status: 'cancelled' };
  }

  await step.run('fulfil-order', async () => {
    console.log(`Fulfilling order ${input.orderId}...`);
    return { fulfilled: true };
  });

  return { status: 'fulfilled', payment: result.data };
});

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
  });

  const engine = new WorkflowEngine({ boss, workflows: [awaitPayment] });
  await engine.start();

  const run = await engine.startWorkflow({
    workflowId: 'await-payment',
    resourceId: 'tenant_1',
    input: { orderId: 'ord_456', paymentId: 'pay_789' },
  });

  // Simulate payment completing after 5 seconds
  setTimeout(() => {
    paymentState = 'completed';
    console.log('\n[Simulation] Payment marked as completed.\n');
  }, 5000);

  // Wait for workflow to finish
  let progress: WorkflowRunProgress;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    progress = await engine.checkProgress({ runId: run.id, resourceId: 'tenant_1' });
    console.log(
      `  Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps) - ${progress.status}`,
    );
  } while (progress.status === 'running' || progress.status === 'paused');

  console.log('\nFinal output:', progress.output);

  await engine.stop();
  await pool.end();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
