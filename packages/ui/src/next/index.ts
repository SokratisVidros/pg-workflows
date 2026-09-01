import type { IncomingMessage, ServerResponse } from 'node:http';
import { type FetchHandler, type FetchHandlerSource, toFetchHandler } from '../server/fetch';
import { toNodeHandler } from '../server/node';

/**
 * App Router route context. Kept so hosts that wrap a per-file handler can
 * type Next's second argument. The handlers themselves dispatch on
 * `request.url` and ignore `params`.
 */
export type RouteContext = { params: { id: string } | Promise<{ id: string }> };

export type RouteHandlers = {
  list: FetchHandler;
  detail: FetchHandler;
  cancel: FetchHandler;
  pause: FetchHandler;
  resume: FetchHandler;
  fastForward: FetchHandler;
  trigger: FetchHandler;
};

export type AppRouterHandler = FetchHandler;
export type AppRouterHandlers = {
  GET: AppRouterHandler;
  POST: AppRouterHandler;
};
export type AppRouterHandlerSource = FetchHandlerSource;

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
export function createAppRouterHandler(source: FetchHandlerSource): AppRouterHandlers {
  const handler = toFetchHandler(source);
  return { GET: handler, POST: handler };
}

/**
 * App Router handlers as one export per endpoint. Prefer
 * {@link createAppRouterHandler} unless you need a `route.ts` per path (for
 * example to wrap mutations in extra auth). Each export is `api.fetch` —
 * Next still provides the full URL, so routing is not reimplemented here.
 * Wire each into a `route.ts`, e.g. `export const GET = handlers.list`
 * / `export const POST = handlers.cancel` (`[id]/cancel/route.ts`).
 */
export function createRouteHandlers(source: FetchHandlerSource): RouteHandlers {
  const handler = toFetchHandler(source);
  return {
    list: handler,
    detail: handler,
    cancel: handler,
    pause: handler,
    resume: handler,
    fastForward: handler,
    trigger: handler,
  };
}

/**
 * Pages Router: a single catch-all Node API handler. Mount at
 * `pages/api/workflow-runs/[[...path]].ts` and create the api with a matching
 * `basePath` (e.g. `createWorkflowRunsApi({ engine, basePath: '/api/workflow-runs' })`).
 */
export function createPagesApiHandler(
  source: FetchHandlerSource,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return toNodeHandler(source);
}
