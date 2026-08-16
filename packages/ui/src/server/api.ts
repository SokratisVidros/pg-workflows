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

  return {
    async listRuns(req) {
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

    async getRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        const run = await engine.getRun({ runId: id, resourceId: ctx.resourceId });
        return json(run, 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async cancelRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.cancelWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async pauseRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.pauseWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async resumeRun(req, id) {
      const ctx = await context(req);
      if (ctx instanceof Response) return ctx;
      try {
        return json(await engine.resumeWorkflow({ runId: id, resourceId: ctx.resourceId }), 200);
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    async fastForwardRun(req, id) {
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

    async triggerEvent(req, id) {
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
}
