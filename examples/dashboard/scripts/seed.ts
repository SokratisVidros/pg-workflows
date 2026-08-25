/**
 * Seeds runs across every state the dashboard renders differently, so the list
 * view, status counters, and detail pane all have something to show.
 *
 * Safe to run more than once — each invocation adds a fresh batch.
 */
import { WorkflowEngine } from 'pg-workflows';
import { workflows } from '../lib/workflows';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and point it at Postgres.');
}

const engine = new WorkflowEngine({
  connectionString,
  workflows,
  logger: { log: () => {}, error: console.error },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);

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

  // Waiting: these stop at `await-payment-confirmation` until an event arrives.
  const waiting = await Promise.all(
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

  // Drive one waiting run to completion, so there's a run with a full timeline
  // including a satisfied waitFor step.
  const [first, , third] = waiting;
  if (first) {
    await engine.triggerEvent({
      runId: first.id,
      resourceId: 'tenant-emea',
      eventName: 'payment-confirmed',
      data: { confirmedBy: 'seed-script' },
    });
  }

  // Paused: an explicitly paused run, distinct from one waiting on an event.
  if (third) {
    await engine.pauseWorkflow({ runId: third.id, resourceId: 'tenant-apac' });
  }

  await sleep(2000);

  const summary = await Promise.all(
    [...completed, failed, ...waiting].map(async (run) => {
      const current = await engine.getRun({
        runId: run.id,
        resourceId: run.resourceId ?? undefined,
      });
      return `  ${run.workflowId.padEnd(18)} ${run.id}  ${current?.status ?? 'unknown'}`;
    }),
  );

  process.stdout.write(`Seeded ${summary.length} runs:\n${summary.join('\n')}\n`);
  process.stdout.write('\nStart the app with `npm run dev` and open http://localhost:3000\n');
} finally {
  await engine.stop();
}
