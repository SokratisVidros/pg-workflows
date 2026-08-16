import { WorkflowRunNotFoundError } from 'pg-workflows';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRunsApi } from './api';

const RUN = { id: 'run_1', workflowId: 'k', status: 'running' } as any;

function mockEngine(overrides: Record<string, unknown> = {}) {
  return {
    getRuns: vi.fn().mockResolvedValue({
      items: [RUN],
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
      hasPrev: false,
    }),
    getRun: vi.fn().mockResolvedValue(RUN),
    pauseWorkflow: vi.fn().mockResolvedValue(RUN),
    resumeWorkflow: vi.fn().mockResolvedValue(RUN),
    cancelWorkflow: vi.fn().mockResolvedValue(RUN),
    fastForwardWorkflow: vi.fn().mockResolvedValue(RUN),
    triggerEvent: vi.fn().mockResolvedValue(RUN),
    ...overrides,
  } as any;
}

describe('createWorkflowRunsApi — reads', () => {
  it('listRuns forwards parsed params + scoped resourceId to engine.getRuns', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({
      engine,
      resolveContext: () => ({ resourceId: 'tenant_a' }),
    });
    const res = await api.listRuns(new Request('http://x/workflow-runs?limit=5&statuses=running'));
    expect(res.status).toBe(200);
    expect(engine.getRuns).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, statuses: ['running'], resourceId: 'tenant_a' }),
    );
  });

  it('getRun forwards runId + resourceId and returns the run', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const res = await api.getRun(new Request('http://x/workflow-runs/run_1'), 'run_1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'run_1' });
    expect(engine.getRun).toHaveBeenCalledWith({ runId: 'run_1', resourceId: undefined });
  });

  it('returns 404 when the engine throws WorkflowRunNotFoundError', async () => {
    const engine = mockEngine({
      getRun: vi.fn().mockRejectedValue(new WorkflowRunNotFoundError('nope')),
    });
    const api = createWorkflowRunsApi({ engine });
    const res = await api.getRun(new Request('http://x/workflow-runs/nope'), 'nope');
    expect(res.status).toBe(404);
  });

  it('returns 401 when resolveContext throws', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({
      engine,
      resolveContext: () => {
        throw new Error('no session');
      },
    });
    const res = await api.listRuns(new Request('http://x/workflow-runs'));
    expect(res.status).toBe(401);
    expect(engine.getRuns).not.toHaveBeenCalled();
  });
});

describe('createWorkflowRunsApi — actions', () => {
  it('cancelRun calls engine.cancelWorkflow with scoped runId and returns the run', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine, resolveContext: () => ({ resourceId: 't1' }) });
    const res = await api.cancelRun(
      new Request('http://x/workflow-runs/run_1/cancel', { method: 'POST' }),
      'run_1',
    );
    expect(res.status).toBe(200);
    expect(engine.cancelWorkflow).toHaveBeenCalledWith({ runId: 'run_1', resourceId: 't1' });
  });

  it('pauseRun and resumeRun map to their engine methods', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    await api.pauseRun(new Request('http://x', { method: 'POST' }), 'r');
    await api.resumeRun(new Request('http://x', { method: 'POST' }), 'r');
    expect(engine.pauseWorkflow).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined });
    expect(engine.resumeWorkflow).toHaveBeenCalledWith({ runId: 'r', resourceId: undefined });
  });

  it('fastForwardRun passes optional data', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ data: { k: 1 } }),
    });
    await api.fastForwardRun(req, 'r');
    expect(engine.fastForwardWorkflow).toHaveBeenCalledWith({
      runId: 'r',
      resourceId: undefined,
      data: { k: 1 },
    });
  });

  it('triggerEvent requires eventName and forwards data', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ eventName: 'go', data: { a: 1 } }),
    });
    await api.triggerEvent(req, 'r');
    expect(engine.triggerEvent).toHaveBeenCalledWith({
      runId: 'r',
      resourceId: undefined,
      eventName: 'go',
      data: { a: 1 },
    });
  });

  it('triggerEvent returns 400 when eventName is missing', async () => {
    const engine = mockEngine();
    const api = createWorkflowRunsApi({ engine });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ data: {} }) });
    const res = await api.triggerEvent(req, 'r');
    expect(res.status).toBe(400);
    expect(engine.triggerEvent).not.toHaveBeenCalled();
  });
});
