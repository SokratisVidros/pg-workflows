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
