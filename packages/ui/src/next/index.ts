import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createWorkflowRunsApi,
  type EngineLike,
  type WorkflowRunsApi,
  type WorkflowRunsApiOptions,
} from '../server/api';
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

/**
 * Pass an engine (or a function that returns one) instead of a prebuilt API.
 * A function is not called until a request arrives, so `next build` can import
 * the route module without opening a database connection. Later requests call
 * it again; return the same engine. The first request awaits `engine.start()`
 * when that method exists, and later requests reuse that promise. The run API
 * is built once from that engine.
 */
export type WorkflowRunsHandlerOptions = Omit<WorkflowRunsApiOptions, 'engine'> & {
  engine: EngineLike | (() => EngineLike | Promise<EngineLike>);
};

export type AppRouterHandlerSource = FetchHandlerSource | WorkflowRunsHandlerOptions;

/**
 * App Router: one optional catch-all. Mount at
 * `app/workflow-runs/[[...path]]/route.ts` (or any path matching `basePath`)
 * and re-export:
 *
 *   export const { GET, POST } = createAppRouterHandler({ engine: getEngine })
 *
 * Prefer this over {@link createRouteHandlers} — `api.fetch` already
 * dispatches on method + path, so one file covers list, detail, and actions.
 * Pass `getEngine`, not `getEngine()`. It is not called until a request arrives,
 * and later requests call it again, so it must return the same engine.
 * An existing {@link WorkflowRunsApi} or `(request) => Response` still works.
 */
export function createAppRouterHandler(source: AppRouterHandlerSource): AppRouterHandlers {
  const handler = toRunsFetchHandler(source);
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
export function createRouteHandlers(source: AppRouterHandlerSource): RouteHandlers {
  const handler = toRunsFetchHandler(source);
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
 * `pages/api/workflow-runs/[[...path]].ts` and pass a matching `basePath`
 * (`createPagesApiHandler({ engine: getEngine, basePath: '/api/workflow-runs' })`).
 */
export function createPagesApiHandler(
  source: AppRouterHandlerSource,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return toNodeHandler(toRunsFetchHandler(source));
}

function toRunsFetchHandler(source: AppRouterHandlerSource): FetchHandler {
  return isHandlerOptions(source) ? bindEngine(source) : toFetchHandler(source);
}

function isHandlerOptions(source: AppRouterHandlerSource): source is WorkflowRunsHandlerOptions {
  return typeof source !== 'function' && 'engine' in source && !('fetch' in source);
}

function hasStart(engine: EngineLike): engine is EngineLike & { start: () => Promise<void> } {
  return typeof (engine as { start?: unknown }).start === 'function';
}

function bindEngine(options: WorkflowRunsHandlerOptions): FetchHandler {
  const { engine: engineSource, ...apiOptions } = options;
  let inflight: Promise<EngineLike> | undefined;
  const started = new WeakMap<EngineLike, Promise<void>>();
  let api: WorkflowRunsApi | undefined;
  let apiEngine: EngineLike | undefined;

  async function resolveEngine(): Promise<EngineLike> {
    if (typeof engineSource !== 'function') return engineSource;
    if (!inflight) {
      inflight = Promise.resolve(engineSource()).finally(() => {
        inflight = undefined;
      });
    }
    return inflight;
  }

  return async (request) => {
    const engine = await resolveEngine();

    if (hasStart(engine)) {
      let ready = started.get(engine);
      if (!ready) {
        ready = Promise.resolve(engine.start()).then(
          () => undefined,
          (error: unknown) => {
            started.delete(engine);
            throw error;
          },
        );
        started.set(engine, ready);
      }
      await ready;
    }

    if (!api || apiEngine !== engine) {
      api = createWorkflowRunsApi({ ...apiOptions, engine });
      apiEngine = engine;
    }
    return api.fetch(request);
  };
}
