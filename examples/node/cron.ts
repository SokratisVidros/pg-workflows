import { WorkflowEngine, workflow } from '../src';

// A recurring workflow.
//
// `schedule` accepts:
//   - a cron expression: '0 9 * * 1-5' (weekdays at 9am)
//   - a duration string: '5m', '1 hour', '1 day'
//   - a DurationObject:  { minutes: 5 }
//
// `timezone` is optional and only meaningful for cron expressions (UTC by default).
// `ctx.schedule.timestamp` is the time this fire was scheduled — present only on
// schedule-triggered runs. Use `engine.getWorkflowLastRun(...)` to fetch the
// previous run when you need a cursor for incremental syncs.

const syncOrders = workflow(
  'sync-orders',
  async ({ step, schedule, workflowId, logger }) => {
    logger.log(
      schedule
        ? `Cron fire at ${schedule.timestamp.toISOString()}`
        : 'Manual run (no schedule context)',
    );

    const lastRun = await engine.getWorkflowLastRun({ workflowId });
    const since = lastRun?.completedAt ?? new Date(0);
    logger.log(`Syncing orders changed since ${since.toISOString()}`);

    const orders = await step.run('fetch-new-orders', async () => {
      return [
        { id: 'ord_1', total: 99.0 },
        { id: 'ord_2', total: 149.5 },
      ];
    });

    await step.run('write-to-warehouse', async () => ({ written: orders.length }));

    return { synced: orders.length, since: since.toISOString() };
  },
  {
    schedule: '5m',
    retries: 3,
  },
);

const engine = new WorkflowEngine({
  connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example',
  workflows: [syncOrders],
});

async function main() {
  await engine.start();
  console.warn('Schedule registered. Waiting for triggers (Ctrl+C to stop)...');

  process.on('SIGINT', async () => {
    console.warn('Shutting down...');
    await engine.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
