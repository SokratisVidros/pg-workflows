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
 * Everything here is deferred to the first request rather than done at import
 * time. `next build` imports every route module to collect its metadata, so
 * constructing a pool — or reading DATABASE_URL — at module scope would make
 * the build depend on a reachable database.
 */
export function getEngine(): WorkflowEngine {
  if (!globalForEngine.pgWorkflowsEngine) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set — copy .env.example to .env and point it at Postgres.',
      );
    }
    globalForEngine.pgWorkflowsEngine = new WorkflowEngine({ connectionString, workflows });
  }
  return globalForEngine.pgWorkflowsEngine;
}

/**
 * Runs migrations and brings up the workers. Lifecycle actions can't enqueue
 * until this resolves, so the catch-all route awaits it — see `runs-api.ts`.
 * Cached, so only the first caller pays for startup.
 */
export function engineReady(): Promise<void> {
  globalForEngine.pgWorkflowsReady ??= getEngine().start();
  return globalForEngine.pgWorkflowsReady;
}
