import { createRouteHandlers, type RouteHandlers } from '@pg-workflows/ui/next';
import { createWorkflowRunsApi } from '@pg-workflows/ui/server';
import { engineReady, getEngine } from './engine';

/**
 * A route handler gets no lifecycle hook in which to await engine startup, so
 * each one waits on the shared start promise first. After the first request it
 * is already resolved and this costs a microtask.
 */
function gated<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    await engineReady();
    return handler(...args);
  };
}

let cached: RouteHandlers | undefined;

/**
 * Built on first use, for the same reason the engine is: `next build` imports
 * these modules, and the adapter needs a live engine to wrap.
 *
 * No `resolveContext` is supplied — this demo is single-tenant and
 * unauthenticated, so the adapter is deliberately open over every run. A real
 * deployment mounts these routes behind its own auth and passes
 * `resolveContext` to scope them; see the Security section of the package README.
 */
function getHandlers(): RouteHandlers {
  if (!cached) {
    const raw = createRouteHandlers(createWorkflowRunsApi({ engine: getEngine() }));
    cached = {
      list: gated(raw.list),
      detail: gated(raw.detail),
      cancel: gated(raw.cancel),
      pause: gated(raw.pause),
      resume: gated(raw.resume),
      fastForward: gated(raw.fastForward),
      trigger: gated(raw.trigger),
    };
  }
  return cached;
}

/** Stable references so route files can `export const GET = handlers.list`. */
export const handlers: RouteHandlers = {
  list: (req) => getHandlers().list(req),
  detail: (req, ctx) => getHandlers().detail(req, ctx),
  cancel: (req, ctx) => getHandlers().cancel(req, ctx),
  pause: (req, ctx) => getHandlers().pause(req, ctx),
  resume: (req, ctx) => getHandlers().resume(req, ctx),
  fastForward: (req, ctx) => getHandlers().fastForward(req, ctx),
  trigger: (req, ctx) => getHandlers().trigger(req, ctx),
};
