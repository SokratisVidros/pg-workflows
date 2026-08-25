import { workflow } from 'pg-workflows';
import { z } from 'zod';

/**
 * Three workflows chosen to cover the states the dashboard renders differently:
 * one that waits on an external event, one that completes, and one that fails.
 */

/** Waits for an external event, so seeded runs sit in a waiting state. */
export const orderFulfillment = workflow(
  'order-fulfillment',
  async ({ step, input }) => {
    const reservation = await step.run('reserve-inventory', async () => {
      await sleep(150);
      return { reservationId: `res_${input.orderId}`, items: input.items };
    });

    const charge = await step.run('charge-card', async () => {
      await sleep(200);
      return { chargeId: `ch_${input.orderId}`, amount: input.items.length * 2500 };
    });

    // The run pauses here until `triggerEvent` delivers `payment-confirmed`.
    const confirmation = await step.waitFor('await-payment-confirmation', {
      eventName: 'payment-confirmed',
      timeout: 7 * 24 * 60 * 60 * 1000,
      schema: z.object({ confirmedBy: z.string() }),
    });

    const shipment = await step.run('ship-order', async () => {
      await sleep(150);
      return { trackingNumber: `1Z${input.orderId}`, carrier: 'UPS' };
    });

    return { reservation, charge, confirmation, shipment };
  },
  {
    inputSchema: z.object({
      orderId: z.string(),
      items: z.array(z.string()),
    }),
    retries: 2,
  },
);

/** Straight-through multi-step run, for the completed state. */
export const nightlyReport = workflow(
  'nightly-report',
  async ({ step, input }) => {
    const rows = await step.run('gather-rows', async () => {
      await sleep(250);
      return { scanned: 4821, region: input.region };
    });

    const aggregate = await step.run('aggregate', async () => {
      await sleep(200);
      return { revenue: 184_320, orders: 512, region: input.region };
    });

    const published = await step.run('publish', async () => {
      await sleep(120);
      return { url: `https://reports.example.com/${input.region}/latest` };
    });

    return { rows, aggregate, published };
  },
  {
    inputSchema: z.object({ region: z.string() }),
    retries: 1,
  },
);

/**
 * Fails partway through on purpose, so the dashboard has a failed run with a
 * populated error and a partial timeline to show.
 */
export const flakyImport = workflow(
  'flaky-import',
  async ({ step, input }) => {
    const batch = await step.run('fetch-batch', async () => {
      await sleep(180);
      return { records: input.size, source: input.source };
    });

    await step.run('validate-batch', async () => {
      await sleep(120);
      throw new Error(`Schema drift in ${input.source}: column "customer_ref" is missing`);
    });

    return { batch };
  },
  {
    inputSchema: z.object({ source: z.string(), size: z.number() }),
    // No retries: the seeded run should reach `failed` promptly rather than
    // spending the demo backing off.
    retries: 0,
  },
);

export const workflows = [orderFulfillment, nightlyReport, flakyImport];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
