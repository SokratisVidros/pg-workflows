import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { WorkflowEngine, workflow } from '../src/';

// A cron workflow that syncs data on a schedule.
// The `schedule` context tells you when this run was triggered
// and when the last successful run completed — useful for
// incremental syncs ("give me everything since last time").

const syncOrders = workflow(
  'sync-orders',
  async ({ step, schedule, logger }) => {
    const since = schedule?.lastTimestamp ?? new Date(0);
    logger.log(`Syncing orders changed since ${since.toISOString()}`);

    const orders = await step.run('fetch-new-orders', async () => {
      // In a real app, query your source system:
      //   SELECT * FROM orders WHERE updated_at > $1
      logger.log(`Fetching orders updated after ${since.toISOString()}...`);
      return [
        { id: 'ord_1', total: 99.0 },
        { id: 'ord_2', total: 149.5 },
      ];
    });

    await step.run('write-to-warehouse', async () => {
      logger.log(`Writing ${orders.length} orders to data warehouse...`);
      return { written: orders.length };
    });

    await step.run('update-metrics', async () => {
      const total = orders.reduce((sum, o) => sum + o.total, 0);
      logger.log(`Updated revenue metric: +$${total.toFixed(2)}`);
      return { revenue: total };
    });

    return {
      synced: orders.length,
      since: since.toISOString(),
      triggeredAt: schedule?.timestamp.toISOString(),
      timezone: schedule?.timezone,
    };
  },
  {
    cron: { expression: '* * * * *', timezone: 'Europe/Athens' },
    retries: 3,
  },
);

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
  });

  const engine = new WorkflowEngine({
    boss,
    workflows: [syncOrders],
  });

  // engine.start() registers the cron schedule with pg-boss.
  // On each trigger, the engine automatically populates
  // schedule.timestamp, schedule.lastTimestamp, and schedule.timezone
  // before invoking the workflow handler.
  await engine.start();

  console.log('Cron workflow registered. Waiting for triggers...');
  console.log('Press Ctrl+C to stop.\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await engine.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
