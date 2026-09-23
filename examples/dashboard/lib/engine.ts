import { WorkflowEngine } from 'pg-workflows';
import { workflows } from './workflows';

/**
 * Next re-evaluates modules on hot reload, and route handlers can be loaded in
 * more than one module graph. Without a global cache each reload would open a
 * fresh pool and register another set of workers against the same queues.
 */
const globalForEngine = globalThis as unknown as {
  pgWorkflowsEngine?: WorkflowEngine;
  pgWorkflowsReady?: Promise<void>;
};

/**
 * Called by `createAppRouterHandler` on each request, never at import time.
 * `next build` imports the route module, so constructing a pool — or reading
 * `DATABASE_URL` — at module scope would make the build depend on a reachable
 * database.
 *
 * Return the same engine every time. The handler awaits `start()` once; this
 * function also awaits it so a workflow added after that first start (a new
 * seed fixture while `next dev` is running) can be registered on a live engine.
 */
export async function getEngine(): Promise<WorkflowEngine> {
  if (!globalForEngine.pgWorkflowsEngine) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set — copy .env.example to .env and point it at Postgres.',
      );
    }
    globalForEngine.pgWorkflowsEngine = new WorkflowEngine({ connectionString, workflows });
  }
  const engine = globalForEngine.pgWorkflowsEngine;
  globalForEngine.pgWorkflowsReady ??= engine.start();
  await globalForEngine.pgWorkflowsReady;
  for (const definition of workflows) {
    if (!engine.workflows.has(definition.id)) {
      await engine.registerWorkflow(definition);
    }
  }
  return engine;
}
