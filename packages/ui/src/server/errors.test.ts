import { WorkflowEngineError, WorkflowRunNotFoundError } from 'pg-workflows';
import { describe, expect, it } from 'vitest';
import { HttpError, json, toErrorResponse } from './errors';

async function body(res: Response) {
  return { status: res.status, json: await res.json() };
}

describe('json', () => {
  it('serializes data with a JSON content-type and status', async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('toErrorResponse', () => {
  it('maps WorkflowRunNotFoundError to 404', async () => {
    expect((await body(toErrorResponse(new WorkflowRunNotFoundError('run_1')))).status).toBe(404);
  });

  it('maps WorkflowEngineError with issues to 400', async () => {
    const err = new WorkflowEngineError('bad', undefined, undefined, undefined, [{ message: 'x' }]);
    const { status, json } = await body(toErrorResponse(err));
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: 'validation' });
  });

  it('maps a plain WorkflowEngineError (illegal transition) to 409', async () => {
    const err = new WorkflowEngineError("Cannot resume workflow run in 'running' status");
    expect((await body(toErrorResponse(err))).status).toBe(409);
  });

  it('passes an HttpError through with its own status and body', async () => {
    const { status, json } = await body(
      toErrorResponse(new HttpError(400, { error: 'validation' })),
    );
    expect(status).toBe(400);
    expect(json).toEqual({ error: 'validation' });
  });

  it('maps unknown errors to 500 without leaking the message', async () => {
    const { status, json } = await body(toErrorResponse(new Error('secret internal detail')));
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('secret internal detail');
  });
});
