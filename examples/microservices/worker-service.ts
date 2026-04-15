/**
 * Worker Service — full engine that registers handlers and executes steps.
 *
 * Imports from `pg-workflows` (the full engine) and defines the actual
 * workflow logic. This is where heavy dependencies (LLM SDKs, email
 * services, etc.) live — they never get loaded in the API service.
 */
import { WorkflowEngine } from 'pg-workflows';
import { onboardUser, processPayment } from './shared/workflows';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

// Call each ref with a handler to create a full WorkflowDefinition
const onboardUserDef = onboardUser(async ({ step, input }) => {
  const user = await step.run('create-account', async () => {
    console.log(`Creating account for ${input.name} (${input.email})...`);
    return { id: `usr_${Date.now()}`, email: input.email, name: input.name };
  });

  await step.run('send-welcome-email', async () => {
    console.log(`Sending welcome email to ${user.email}...`);
    return { sent: true };
  });

  await step.run('provision-resources', async () => {
    console.log(`Provisioning resources for ${user.id}...`);
    return { provisioned: true };
  });

  return { userId: user.id, status: 'onboarded' };
});

const processPaymentDef = processPayment(async ({ step, input }) => {
  const charge = await step.run('create-charge', async () => {
    console.log(`Charging ${input.amount} ${input.currency} for order ${input.orderId}...`);
    return { chargeId: `ch_${Date.now()}`, status: 'succeeded' };
  });

  await step.run('send-receipt', async () => {
    console.log(`Sending receipt for charge ${charge.chargeId}...`);
    return { sent: true };
  });

  return { chargeId: charge.chargeId, status: charge.status };
});

async function main() {
  const engine = new WorkflowEngine({
    connectionString: DATABASE_URL,
    workflows: [onboardUserDef, processPaymentDef],
  });

  await engine.start();
  console.log('Worker service started. Listening for workflow jobs...');

  // Keep the process alive
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await engine.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Worker service failed:', err);
  process.exit(1);
});
