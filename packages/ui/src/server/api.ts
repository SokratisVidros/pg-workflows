import type { WorkflowEngine } from 'pg-workflows';
import { json, toErrorResponse } from './errors';
import { parseFastForwardBody, parseListParams, parseTriggerBody, readJson } from './params';

export type RunsContext = { resourceId?: string };

export type EngineLike = Pick<
  WorkflowEngine,
  | 'getRuns'
  | 'getRun'
  | 'pauseWorkflow'
  | 'resumeWorkflow'
  | 'cancelWorkflow'
  | 'fastForwardWorkflow'
  | 'triggerEvent'
>;

export type WorkflowRunsApiOptions = {
  engine: EngineLike;
  basePath?: string;
  resolveContext?: (req: Request) => RunsContext | Promise<RunsContext>;
};

export type WorkflowRunsApi = {
  listRuns: (req: Request) => Promise<Response>;
  getRun: (req: Request, id: string) => Promise<Response>;
  cancelRun: (req: Request, id: string) => Promise<Response>;
  pauseRun: (req: Request, id: string) => Promise<Response>;
  resumeRun: (req: Request, id: string) => Promise<Response>;
  fastForwardRun: (req: Request, id: string) => Promise<Response>;
  triggerEvent: (req: Request, id: string) => Promise<Response>;
  fetch: (req: Request) => Promise<Response>;
};

export function createWorkflowRunsApi(opts: WorkflowRunsApiOptions): WorkflowRunsApi {
  const { engine, resolveContext } = opts;

  async function context(req: Request): Promise<RunsContext | Response> {
    if (!resolveContext) return {};
    try {
      return await resolveContext(req);
    } catch {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  const api = {
    async listRuns(req: Request) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const params = parseListParams(new URL(req.url));
        const result = await engine.getRuns({ ...params, resourceId: ctx.resourceId });
        return json(result, 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async getRun(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const run = await engine.getRun({ runId: id, resourceId: ctx.resourceId });
        return json(run, 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async cancelRun(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.cancelWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async pauseRun(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.pauseWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async resumeRun(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.resumeWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async fastForwardRun(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const { data } = parseFastForwardBody(await readJson(req));
        return json(
          await engine.fastForwardWorkflow({ runId: id, resourceId: ctx.resourceId, data }),
          200,
        );
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async triggerEvent(req: Request, id: string) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const { eventName, data } = parseTriggerBody(await readJson(req));
        return json(
          await engine.triggerEvent({ runId: id, resourceId: ctx.resourceId, eventName, data }),
          200,
        );
      } catch (err) {
        return toErrorResponse(err);
      }
    },
  };

  const basePath = (opts.basePath ?? '/workflow-runs').replace(/\/$/, '');

  const ACTIONS: Record<string, (req: Request, id: string) => Promise<Response>> = {
    cancel: api.cancelRun,
    pause: api.pauseRun,
    resume: api.resumeRun,
    'fast-forward': api.fastForwardRun,
    trigger: api.triggerEvent,
  };

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return json({ error: 'not_found' }, 404);
    }
    const rest = url.pathname.slice(basePath.length).replace(/^\//, '');
    const segments = rest ? rest.split('/') : [];

    if (segments.length === 0) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return api.listRuns(req);
    }
    const [id, action] = segments;
    if (segments.length === 1 && id !== undefined) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return api.getRun(req, id);
    }
    if (segments.length === 2 && id !== undefined && action !== undefined && ACTIONS[action]) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return ACTIONS[action](req, id);
    }
    return json({ error: 'not_found' }, 404);
  }

  return { ...api, fetch };
}
