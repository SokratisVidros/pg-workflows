import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkflowRunsApi } from '../server/api';
import { toNodeHandler } from '../server/node';

/**
 * App Router route context for the per-file handlers from
 * {@link createRouteHandlers}. `params` may be a plain object (Next 14) or a
 * Promise (Next 15+); both are supported.
 */
export type RouteContext = { params: { id: string } | Promise<{ id: string }> };

async function routeId(ctx: RouteContext): Promise<string> {
  return (await ctx.params).id;
}

export type RouteHandlers = {
  list: (req: Request) => Promise<Response>;
  detail: (req: Request, ctx: RouteContext) => Promise<Response>;
  cancel: (req: Request, ctx: RouteContext) => Promise<Response>;
  pause: (req: Request, ctx: RouteContext) => Promise<Response>;
  resume: (req: Request, ctx: RouteContext) => Promise<Response>;
  fastForward: (req: Request, ctx: RouteContext) => Promise<Response>;
  trigger: (req: Request, ctx: RouteContext) => Promise<Response>;
};

export type AppRouterHandler = (request: Request) => Promise<Response>;

export type AppRouterHandlers = {
  GET: AppRouterHandler;
  POST: AppRouterHandler;
};

export type AppRouterHandlerSource = Pick<WorkflowRunsApi, 'fetch'> | AppRouterHandler;

/**
 * App Router: one optional catch-all. Mount at
 * `app/workflow-runs/[[...path]]/route.ts` (or any path matching `basePath`)
 * and re-export:
 *
 *   export const { GET, POST } = createAppRouterHandler(api)
 *
 * Prefer this over {@link createRouteHandlers} — `api.fetch` already
 * dispatches on method + path, so one file covers list, detail, and actions.
 * Pass either the api or a `(request) => api.fetch(request)` wrapper (e.g. to
 * await engine startup before the first request).
 */
export function createAppRouterHandler(apiOrFetch: AppRouterHandlerSource): AppRouterHandlers {
  const handler: AppRouterHandler =
    typeof apiOrFetch === 'function' ? apiOrFetch : (request) => apiOrFetch.fetch(request);
  return { GET: handler, POST: handler };
}

/**
 * App Router handlers as one export per endpoint. Prefer
 * {@link createAppRouterHandler} unless you need a `route.ts` per path (for
 * example to wrap mutations in extra auth). Wire each into a `route.ts`, e.g.
 * `export const GET = handlers.list` (collection) /
 * `export const POST = handlers.cancel` (`[id]/cancel/route.ts`).
 */
export function createRouteHandlers(api: WorkflowRunsApi): RouteHandlers {
  return {
    list: (req) => api.listRuns(req),
    detail: async (req, ctx) => api.getRun(req, await routeId(ctx)),
    cancel: async (req, ctx) => api.cancelRun(req, await routeId(ctx)),
    pause: async (req, ctx) => api.pauseRun(req, await routeId(ctx)),
    resume: async (req, ctx) => api.resumeRun(req, await routeId(ctx)),
    fastForward: async (req, ctx) => api.fastForwardRun(req, await routeId(ctx)),
    trigger: async (req, ctx) => api.triggerEvent(req, await routeId(ctx)),
  };
}

/**
 * Pages Router: a single catch-all Node API handler. Mount at
 * `pages/api/workflow-runs/[[...path]].ts` and create the api with a matching
 * `basePath` (e.g. `createWorkflowRunsApi({ engine, basePath: '/api/workflow-runs' })`).
 */
export function createPagesApiHandler(
  api: WorkflowRunsApi,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return toNodeHandler(api.fetch);
}
