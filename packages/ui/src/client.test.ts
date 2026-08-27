import { describe, expect, it, vi } from 'vitest';
import { createFetchClient } from './client';

describe('createFetchClient', () => {
  it('lists runs by hitting GET {baseUrl} with query params', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          nextCursor: null,
          prevCursor: null,
          hasMore: false,
          hasPrev: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.listRuns({ limit: 20, statuses: ['running'] });
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(fetch.mock.calls[0][0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/wfr');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.getAll('statuses')).toEqual(['running']);
  });

  it('gets a run by id', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'run_x', workflowId: 'k', status: 'completed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    const run = await client.getRun('run_x');
    expect(run.id).toBe('run_x');
    expect(fetch).toHaveBeenCalledWith(
      '/api/wfr/run_x',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on non-2xx responses with status code in the message', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await expect(client.getRun('nope')).rejects.toThrow(/404/);
  });
});

describe('createFetchClient mutations', () => {
  function okRun(fields: Record<string, unknown>) {
    return new Response(JSON.stringify(fields), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('cancelRun POSTs to {baseUrl}/{id}/cancel and returns the run', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'run_x', status: 'cancelled' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    const run = await client.cancelRun('run_x');
    expect(run.status).toBe('cancelled');
    expect(fetch).toHaveBeenCalledWith(
      '/api/wfr/run_x/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('pauseRun and resumeRun POST to their action paths', async () => {
    const fetch = vi.fn(() => Promise.resolve(okRun({ id: 'r' })));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.pauseRun('r');
    await client.resumeRun('r');
    expect(fetch.mock.calls[0][0]).toBe('/api/wfr/r/pause');
    expect(fetch.mock.calls[1][0]).toBe('/api/wfr/r/resume');
  });

  it('fastForwardRun sends an optional JSON data body', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'r' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.fastForwardRun('r', { data: { k: 1 } });
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ data: { k: 1 } });
  });

  it('triggerEvent POSTs eventName + data to the trigger path', async () => {
    const fetch = vi.fn().mockResolvedValue(okRun({ id: 'r' }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await client.triggerEvent('r', { eventName: 'go', data: { a: 1 } });
    expect(fetch.mock.calls[0][0]).toBe('/api/wfr/r/trigger');
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      eventName: 'go',
      data: { a: 1 },
    });
  });

  it('throws on a non-2xx action response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('conflict', { status: 409 }));
    const client = createFetchClient({ baseUrl: '/api/wfr', fetch });
    await expect(client.pauseRun('r')).rejects.toThrow(/409/);
  });
});
