import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRunsApi } from '../server/api';
import { createAppRouterHandler, createPagesApiHandler, createRouteHandlers } from './index';

function mockApi() {
  return {
    listRuns: vi.fn().mockResolvedValue(new Response('list')),
    getRun: vi.fn().mockResolvedValue(new Response('get')),
    cancelRun: vi.fn().mockResolvedValue(new Response('cancel')),
    pauseRun: vi.fn().mockResolvedValue(new Response('pause')),
    resumeRun: vi.fn().mockResolvedValue(new Response('resume')),
    fastForwardRun: vi.fn().mockResolvedValue(new Response('ff')),
    triggerEvent: vi.fn().mockResolvedValue(new Response('trigger')),
    fetch: vi.fn().mockImplementation(() => Promise.resolve(new Response('fetch'))),
  };
}

function mockEngine() {
  return {
    getRuns: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
      hasPrev: false,
    }),
    getRun: vi.fn().mockResolvedValue({ id: 'run_1' }),
    pauseWorkflow: vi.fn().mockResolvedValue({ id: 'run_1' }),
    resumeWorkflow: vi.fn().mockResolvedValue({ id: 'run_1' }),
    cancelWorkflow: vi.fn().mockResolvedValue({ id: 'run_1' }),
    fastForwardWorkflow: vi.fn().mockResolvedValue({ id: 'run_1' }),
    triggerEvent: vi.fn().mockResolvedValue({ id: 'run_1' }),
  };
}

describe('createAppRouterHandler (App Router catch-all)', () => {
  it('GET and POST both delegate to api.fetch with the incoming request', async () => {
    const api = mockApi();
    const { GET, POST } = createAppRouterHandler(api as never);
    const getReq = new Request('http://x/workflow-runs');
    const postReq = new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' });
    expect(await (await GET(getReq)).text()).toBe('fetch');
    expect(await (await POST(postReq)).text()).toBe('fetch');
    expect(api.fetch).toHaveBeenCalledWith(getReq);
    expect(api.fetch).toHaveBeenCalledWith(postReq);
  });

  it('accepts a raw fetch function (for wrapping engine startup)', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('wrapped')));
    const { GET, POST } = createAppRouterHandler(fetch);
    const req = new Request('http://x/workflow-runs');
    expect(await (await GET(req)).text()).toBe('wrapped');
    expect(await (await POST(req)).text()).toBe('wrapped');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('GET and POST are the same handler, so Next can re-export both from one catch-all', () => {
    const { GET, POST } = createAppRouterHandler(mockApi() as never);
    expect(GET).toBe(POST);
  });

  it('routes list, detail, and actions through api.fetch using the request URL', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine: engine as never });
    const { GET, POST } = createAppRouterHandler(api);

    const list = await GET(new Request('http://x/workflow-runs?limit=5'));
    expect(list.status).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();

    await GET(new Request('http://x/workflow-runs/run_1'));
    expect(engine.getRun).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });

    await POST(new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' }));
    expect(engine.cancelWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });

    await POST(
      new Request('http://x/workflow-runs/run_1/trigger', {
        method: 'POST',
        body: JSON.stringify({ eventName: 'go' }),
      }),
    );
    expect(engine.triggerEvent).toHaveBeenCalledWith({
      runId: 'run_1',
      resourceId: undefined,
      eventName: 'go',
      data: undefined,
    });
  });

  it('ignores Next route context (catch-all params) and still dispatches on the URL', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine: engine as never });
    const { POST } = createAppRouterHandler(api);
    const req = new Request('http://x/workflow-runs/run_1/pause', { method: 'POST' });
    const ctx = { params: Promise.resolve({ path: ['run_1', 'pause'] }) };
    // Next always passes a second argument; the catch-all handler must not need it.
    await (POST as (req: Request, ctx?: unknown) => Promise<Response>)(req, ctx);
    expect(engine.pauseWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });
});

describe('createRouteHandlers (App Router per-file)', () => {
  it('every per-file export is the same fetch handler, ignoring Next params', async () => {
    const api = mockApi();
    const handlers = createRouteHandlers(api as never);
    expect(handlers.list).toBe(handlers.detail);
    expect(handlers.detail).toBe(handlers.cancel);
    expect(handlers.cancel).toBe(handlers.pause);
    expect(handlers.pause).toBe(handlers.resume);
    expect(handlers.resume).toBe(handlers.fastForward);
    expect(handlers.fastForward).toBe(handlers.trigger);
  });

  it('list, detail, and actions dispatch through api.fetch using the request URL', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine: engine as never });
    const handlers = createRouteHandlers(api);
    const ctx = { params: { id: 'ignored' } };

    const list = await handlers.list(new Request('http://x/workflow-runs?limit=5'));
    expect(list.status).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();

    await handlers.detail(new Request('http://x/workflow-runs/run_1'), ctx);
    expect(engine.getRun).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });

    await handlers.cancel(
      new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' }),
      ctx,
    );
    expect(engine.cancelWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });

    await handlers.trigger(
      new Request('http://x/workflow-runs/run_1/trigger', {
        method: 'POST',
        body: JSON.stringify({ eventName: 'go' }),
      }),
      ctx,
    );
    expect(engine.triggerEvent).toHaveBeenCalledWith({
      runId: 'run_1',
      resourceId: undefined,
      eventName: 'go',
      data: undefined,
    });
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
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine: engine as never, basePath: '/api/workflow-runs' });
    const handler = createPagesApiHandler(api);
    const res = fakeRes();
    await handler(fakeReq('GET', '/api/workflow-runs?limit=5') as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(engine.getRuns).toHaveBeenCalled();
  });

  it('accepts a raw fetch function the same way createAppRouterHandler does', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('wrapped')));
    const handler = createPagesApiHandler(fetch);
    const res = fakeRes();
    await handler(fakeReq('GET', '/workflow-runs') as never, res as never);
    expect(res.body).toBe('wrapped');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
