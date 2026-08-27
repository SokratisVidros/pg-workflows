import { WorkflowStatus } from 'pg-workflows';
import { z } from 'zod';
import { HttpError } from './errors';

const listQuery = z.object({
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  workflow_id: z.string().optional(),
  statuses: z.array(z.enum(WorkflowStatus)).optional(),
});

export function parseListParams(url: URL) {
  const statuses = url.searchParams.getAll('statuses');
  const parsed = listQuery.safeParse({
    starting_after: url.searchParams.get('starting_after') ?? undefined,
    ending_before: url.searchParams.get('ending_before') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    workflow_id: url.searchParams.get('workflow_id') ?? undefined,
    statuses: statuses.length ? statuses : undefined,
  });
  if (!parsed.success)
    throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  const d = parsed.data;
  return {
    startingAfter: d.starting_after,
    endingBefore: d.ending_before,
    limit: d.limit,
    workflowId: d.workflow_id,
    statuses: d.statuses,
  };
}

const triggerBody = z.object({
  eventName: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

const fastForwardBody = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
});

export function parseTriggerBody(raw: unknown) {
  const parsed = triggerBody.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  return parsed.data;
}

export function parseFastForwardBody(raw: unknown) {
  const parsed = fastForwardBody.safeParse(raw ?? {});
  if (!parsed.success)
    throw new HttpError(400, { error: 'validation', issues: parsed.error.issues });
  return parsed.data;
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { error: 'validation', message: 'Invalid JSON body' });
  }
}
