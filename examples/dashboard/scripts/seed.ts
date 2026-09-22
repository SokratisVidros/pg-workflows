/**
 * Seeds runs across every state the dashboard renders differently, so the list
 * view, status counters, and detail pane all have something to show.
 *
 * Safe to run more than once — each invocation adds a fresh batch.
 */
import { WorkflowEngine } from 'pg-workflows';
import { CATALOG_REINDEX_DURATION_MS, workflows } from '../lib/workflows';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and point it at Postgres.');
}

const logger = { log: () => {}, error: console.error };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);

const engine = new WorkflowEngine({
  connectionString,
  workflows,
  logger,
});

const lines: string[] = [];

const snapshot = async (
  target: WorkflowEngine,
  runs: { workflowId: string; id: string; resourceId: string | null }[],
) => {
  const rows = await Promise.all(
    runs.map(async (run) => {
      const current = await target.getRun({
        runId: run.id,
        resourceId: run.resourceId ?? undefined,
      });
      return `  ${run.workflowId.padEnd(18)} ${run.id}  ${current?.status ?? 'unknown'}`;
    }),
  );
  lines.push(...rows);
};

await engine.start();

try {
  // Completed: let these run to the end.
  const completed = await Promise.all(
    ['emea', 'apac'].map((region) =>
      engine.startWorkflow({
        workflowId: 'nightly-report',
        resourceId: `tenant-${region}`,
        input: { region },
      }),
    ),
  );

  // Failed: throws in `validate-batch`, with retries disabled.
  const failed = await engine.startWorkflow({
    workflowId: 'flaky-import',
    resourceId: 'tenant-emea',
    input: { source: 'legacy-crm', size: 2048 },
  });

  /**
   * These stop at `await-payment-confirmation`. Note that a run blocked on
   * `step.waitFor` reports status `paused` — there is no separate "waiting"
   * status, so these are already the paused runs and calling `pauseWorkflow`
   * on one would throw.
   */
  const awaitingEvent = await Promise.all(
    [1, 2, 3].map((n) =>
      engine.startWorkflow({
        workflowId: 'order-fulfillment',
        resourceId: n === 3 ? 'tenant-apac' : 'tenant-emea',
        input: { orderId: `${stamp}-${n}`, items: ['sku-1', 'sku-2'].slice(0, n === 1 ? 1 : 2) },
      }),
    ),
  );

  // Give the workers time to advance each run to its resting state.
  await sleep(4000);

  const [first, , third] = awaitingEvent;

  // Deliver the event to one, so there's a run with a full timeline including a
  // satisfied waitFor step.
  if (first) {
    await engine.triggerEvent({
      runId: first.id,
      resourceId: 'tenant-emea',
      eventName: 'payment-confirmed',
      data: { confirmedBy: 'seed-script' },
    });
  }

  // Cancel another, for a terminal run that neither completed nor failed.
  if (third) {
    await engine.cancelWorkflow({ runId: third.id, resourceId: 'tenant-apac' });
  }

  await sleep(2000);

  await snapshot(engine, [...completed, failed, ...awaitingEvent]);
} finally {
  await engine.stop();
}

/**
 * Enqueue in-progress runs with no workers so this process can exit immediately
 * instead of waiting out a graceful shutdown of an 8-hour `step.run`. The
 * dashboard process picks them up; they stay `running` until reindex finishes.
 */
const publisher = new WorkflowEngine({
  connectionString,
  workflows,
  logger,
});
await publisher.start(false);

try {
  const running = await Promise.all(
    ['emea', 'nam'].map((region) =>
      publisher.startWorkflow({
        workflowId: 'catalog-reindex',
        resourceId: `tenant-${region}`,
        input: { region, documents: 50_000 },
        options: {
          expireInSeconds: Math.ceil(CATALOG_REINDEX_DURATION_MS / 1000) + 5 * 60,
        },
      }),
    ),
  );
  await snapshot(publisher, running);
} finally {
  await publisher.stop();
}

process.stdout.write(`Seeded ${lines.length} runs:\n${lines.join('\n')}\n`);
process.stdout.write('\nStart the app with `bun run dev` and open http://localhost:3000\n');
