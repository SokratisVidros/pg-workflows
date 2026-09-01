import { createWorkflowRunsApi, type WorkflowRunsApi } from '@pg-workflows/ui/server';
import { engineReady, getEngine } from './engine';

let cached: WorkflowRunsApi | undefined;

function getApi(): WorkflowRunsApi {
  cached ??= createWorkflowRunsApi({ engine: getEngine() });
  return cached;
}

/**
 * Built on first use, for the same reason the engine is: `next build` imports
 * every route module to collect metadata, so constructing a pool — or wrapping
 * a live engine — at module scope would make the build depend on a reachable
 * database.
 *
 * A route handler also has no lifecycle hook in which to await `engine.start()`,
 * so every request waits on the shared start promise first. After the first
 * request it is already resolved and this costs a microtask.
 *
 * No `resolveContext` is supplied — this demo is single-tenant and
 * unauthenticated, so the adapter is deliberately open over every run. A real
 * deployment mounts these routes behind its own auth and passes
 * `resolveContext` to scope them; see the Security section of the package README.
 */
export const runsApi: Pick<WorkflowRunsApi, 'fetch'> = {
  fetch: async (req) => {
    await engineReady();
    return getApi().fetch(req);
  },
};
