import { WorkflowEngineError, WorkflowRunNotFoundError } from 'pg-workflows';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(typeof body === 'string' ? body : `HttpError ${status}`);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json(err.body, err.status);
  if (err instanceof WorkflowRunNotFoundError) {
    return json({ error: 'not_found', message: err.message }, 404);
  }
  if (err instanceof WorkflowEngineError) {
    if (err.issues)
      return json({ error: 'validation', message: err.message, issues: err.issues }, 400);
    return json({ error: 'conflict', message: err.message }, 409);
  }
  return json({ error: 'internal', message: 'Internal Server Error' }, 500);
}
