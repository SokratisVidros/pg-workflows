import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRunsApi } from '../server/api';
import { createPagesApiHandler, createRouteHandlers } from './index';

function mockApi() {
  return {
    listRuns: vi.fn().mockResolvedValue(new Response('list')),
    getRun: vi.fn().mockResolvedValue(new Response('get')),
    cancelRun: vi.fn().mockResolvedValue(new Response('cancel')),
    pauseRun: vi.fn().mockResolvedValue(new Response('pause')),
    resumeRun: vi.fn().mockResolvedValue(new Response('resume')),
    fastForwardRun: vi.fn().mockResolvedValue(new Response('ff')),
    triggerEvent: vi.fn().mockResolvedValue(new Response('trigger')),
    fetch: vi.fn().mockResolvedValue(new Response('fetch')),
  };
}

describe('createRouteHandlers (App Router)', () => {
  it('list delegates to api.listRuns', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs');
    await createRouteHandlers(api as never).list(req);
    expect(api.listRuns).toHaveBeenCalledWith(req);
  });

  it('detail resolves a SYNC params object (Next 14) and calls getRun with the id', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs/run_1');
    await createRouteHandlers(api as never).detail(req, { params: { id: 'run_1' } });
    expect(api.getRun).toHaveBeenCalledWith(req, 'run_1');
  });

  it('detail resolves an ASYNC params promise (Next 15) and calls getRun with the id', async () => {
    const api = mockApi();
    const req = new Request('http://x/workflow-runs/run_2');
    await createRouteHandlers(api as never).detail(req, {
      params: Promise.resolve({ id: 'run_2' }),
    });
    expect(api.getRun).toHaveBeenCalledWith(req, 'run_2');
  });

  it('each action handler maps to the matching api op with the resolved id', async () => {
    const api = mockApi();
    const handlers = createRouteHandlers(api as never);
    const req = new Request('http://x', { method: 'POST' });
    await handlers.cancel(req, { params: { id: 'r' } });
    await handlers.pause(req, { params: { id: 'r' } });
    await handlers.resume(req, { params: { id: 'r' } });
    await handlers.fastForward(req, { params: { id: 'r' } });
    await handlers.trigger(req, { params: { id: 'r' } });
    expect(api.cancelRun).toHaveBeenCalledWith(req, 'r');
    expect(api.pauseRun).toHaveBeenCalledWith(req, 'r');
    expect(api.resumeRun).toHaveBeenCalledWith(req, 'r');
    expect(api.fastForwardRun).toHaveBeenCalledWith(req, 'r');
    expect(api.triggerEvent).toHaveBeenCalledWith(req, 'r');
  });
});

function fakeReq(method: string, url: string, body?: string) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as unknown as {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  stream.method = method;
  stream.url = url;
  stream.headers = { host: 'localhost' };
  return stream;
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk?: Buffer | string) {
      this.body = chunk ? chunk.toString() : '';
    },
  };
}

describe('createPagesApiHandler (Pages Router)', () => {
  it('bridges a Node request through api.fetch to the engine, honoring basePath', async () => {
    const engine = {
      getRuns: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
        hasPrev: false,
      }),
      getRun: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      cancelWorkflow: vi.fn(),
      fastForwardWorkflow: vi.fn(),
      triggerEvent: vi.fn(),
    };
    const api = createWorkflowRunsApi({ engine: engine as never, basePath: '/api/workflow-runs' });
    const handler = createPagesApiHandler(api);
    const res = fakeRes();
    await handler(fakeReq('GET', '/api/workflow-runs?limit=5') as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();
  });
});
