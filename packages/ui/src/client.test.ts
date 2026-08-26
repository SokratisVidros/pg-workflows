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
