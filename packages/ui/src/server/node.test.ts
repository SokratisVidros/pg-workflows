import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { toNodeHandler } from './node';

function fakeReq(method: string, url: string, body?: string) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as any;
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

describe('toNodeHandler', () => {
  it('bridges a GET into the fetch handler and writes the response back', async () => {
    const handler = toNodeHandler(async (req) => {
      expect(new URL(req.url).pathname).toBe('/workflow-runs');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const res = fakeRes();
    await handler(fakeReq('GET', '/workflow-runs') as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('forwards a POST body', async () => {
    const handler = toNodeHandler(async (req) => {
      const json = await req.json();
      return new Response(JSON.stringify(json), { status: 201 });
    });
    const res = fakeRes();
    await handler(
      fakeReq('POST', '/workflow-runs/r/trigger', JSON.stringify({ eventName: 'e' })) as any,
      res as any,
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ eventName: 'e' });
  });
});
