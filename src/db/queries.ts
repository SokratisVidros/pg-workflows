import ksuid from 'ksuid';
import type { Db } from 'pg-boss';
import type { WorkflowRun } from './types';

export function generateKSUID(prefix?: string): string {
  return `${prefix ? `${prefix}_` : ''}${ksuid.randomSync().string}`;
}

type WorkflowRunRow = {
  id: string;
  created_at: string | Date;
  updated_at: string | Date;
  resource_id: string | null;
  workflow_id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  input: string | unknown;
  output: string | unknown | null;
  error: string | null;
  current_step_id: string;
  timeline: string | Record<string, unknown>;
  paused_at: string | Date | null;
  resumed_at: string | Date | null;
  completed_at: string | Date | null;
  timeout_at: string | Date | null;
  retry_count: number;
  max_retries: number;
  job_id: string | null;
  cron: string | null;
  timezone: string | null;
};

function mapRowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    resourceId: row.resource_id,
    workflowId: row.workflow_id,
    status: row.status,
    input: typeof row.input === 'string' ? JSON.parse(row.input) : row.input,
    output:
      typeof row.output === 'string'
        ? row.output.trim().startsWith('{') || row.output.trim().startsWith('[')
          ? JSON.parse(row.output)
          : row.output
        : (row.output ?? null),
    error: row.error,
    currentStepId: row.current_step_id,
    timeline: typeof row.timeline === 'string' ? JSON.parse(row.timeline) : row.timeline,
    pausedAt: row.paused_at ? new Date(row.paused_at) : null,
    resumedAt: row.resumed_at ? new Date(row.resumed_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    timeoutAt: row.timeout_at ? new Date(row.timeout_at) : null,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    jobId: row.job_id,
    cron: row.cron,
    timezone: row.timezone,
  };
}

export async function insertWorkflowRun(
  {
    resourceId,
    workflowId,
    currentStepId,
    status,
    input,
    maxRetries,
    timeoutAt,
    cron,
    timezone,
  }: {
    resourceId?: string;
    workflowId: string;
    currentStepId: string;
    status: string;
    input: unknown;
    maxRetries: number;
    timeoutAt: Date | null;
    cron?: string;
    timezone?: string;
  },
  db: Db,
): Promise<WorkflowRun> {
  const runId = generateKSUID('run');
  const now = new Date();

  const result = await db.executeSql(
    `INSERT INTO workflow_runs (
      id,
      resource_id,
      workflow_id,
      current_step_id,
      status,
      input,
      max_retries,
      timeout_at,
      created_at,
      updated_at,
      timeline,
      retry_count,
      cron,
      timezone
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      runId,
      resourceId ?? null,
      workflowId,
      currentStepId,
      status,
      JSON.stringify(input),
      maxRetries,
      timeoutAt,
      now,
      now,
      '{}',
      0,
      cron ?? null,
      timezone ?? null,
    ],
  );

  const insertedRun = result.rows[0];

  if (!insertedRun) {
    throw new Error('Failed to insert workflow run');
  }

  return mapRowToWorkflowRun(insertedRun);
}

export async function getWorkflowRun(
  {
    runId,
    resourceId,
  }: {
    runId: string;
    resourceId?: string;
  },
  { exclusiveLock = false, db }: { exclusiveLock?: boolean; db: Db },
): Promise<WorkflowRun | null> {
  const lockSuffix = exclusiveLock ? 'FOR UPDATE' : '';

  const result = resourceId
    ? await db.executeSql(
        `SELECT * FROM workflow_runs 
        WHERE id = $1 AND resource_id = $2
        ${lockSuffix}`,
        [runId, resourceId],
      )
    : await db.executeSql(
        `SELECT * FROM workflow_runs 
        WHERE id = $1
        ${lockSuffix}`,
        [runId],
      );

  const run = result.rows[0];

  if (!run) {
    return null;
  }

  return mapRowToWorkflowRun(run);
}

export async function getWorkflowLastRun(
  workflowId: string,
  db: Db,
): Promise<WorkflowRun | undefined> {
  const result = await db.executeSql(
    `SELECT * FROM workflow_runs
     WHERE workflow_id = $1 AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [workflowId],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return mapRowToWorkflowRun(row);
}

export async function updateWorkflowRun(
  {
    runId,
    resourceId,
    data,
  }: {
    runId: string;
    resourceId?: string;
    data: Partial<WorkflowRun>;
  },
  db: Db,
): Promise<WorkflowRun | null> {
  const now = new Date();

  const updates: string[] = ['updated_at = $1'];
  const values: (string | number | Date | null)[] = [now];
  let paramIndex = 2;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(data.status);
    paramIndex++;
  }
  if (data.currentStepId !== undefined) {
    updates.push(`current_step_id = $${paramIndex}`);
    values.push(data.currentStepId);
    paramIndex++;
  }
  if (data.timeline !== undefined) {
    updates.push(`timeline = $${paramIndex}`);
    values.push(JSON.stringify(data.timeline));
    paramIndex++;
  }
  if (data.pausedAt !== undefined) {
    updates.push(`paused_at = $${paramIndex}`);
    values.push(data.pausedAt);
    paramIndex++;
  }
  if (data.resumedAt !== undefined) {
    updates.push(`resumed_at = $${paramIndex}`);
    values.push(data.resumedAt);
    paramIndex++;
  }
  if (data.completedAt !== undefined) {
    updates.push(`completed_at = $${paramIndex}`);
    values.push(data.completedAt);
    paramIndex++;
  }
  if (data.output !== undefined) {
    updates.push(`output = $${paramIndex}`);
    values.push(JSON.stringify(data.output));
    paramIndex++;
  }
  if (data.error !== undefined) {
    updates.push(`error = $${paramIndex}`);
    values.push(data.error);
    paramIndex++;
  }
  if (data.retryCount !== undefined) {
    updates.push(`retry_count = $${paramIndex}`);
    values.push(data.retryCount);
    paramIndex++;
  }
  if (data.jobId !== undefined) {
    updates.push(`job_id = $${paramIndex}`);
    values.push(data.jobId);
    paramIndex++;
  }

  const whereClause = resourceId
    ? `WHERE id = $${paramIndex} AND resource_id = $${paramIndex + 1}`
    : `WHERE id = $${paramIndex}`;

  values.push(runId);
  if (resourceId) {
    values.push(resourceId);
  }

  const query = `
    UPDATE workflow_runs 
    SET ${updates.join(', ')}
    ${whereClause}
    RETURNING *
  `;

  const result = await db.executeSql(query, values);
  const run = result.rows[0];

  if (!run) {
    return null;
  }

  return mapRowToWorkflowRun(run);
}

export async function getWorkflowRuns(
  {
    resourceId,
    startingAfter,
    endingBefore,
    limit = 20,
    statuses,
    workflowId,
  }: {
    resourceId?: string;
    startingAfter?: string | null;
    endingBefore?: string | null;
    limit?: number;
    statuses?: string[];
    workflowId?: string;
  },
  db: Db,
): Promise<{
  items: WorkflowRun[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  hasPrev: boolean;
}> {
  const conditions: string[] = [];
  const values: (string | number | string[] | Date)[] = [];
  let paramIndex = 1;

  if (resourceId) {
    conditions.push(`resource_id = $${paramIndex}`);
    values.push(resourceId);
    paramIndex++;
  }

  if (statuses && statuses.length > 0) {
    conditions.push(`status = ANY($${paramIndex})`);
    values.push(statuses);
    paramIndex++;
  }

  if (workflowId) {
    conditions.push(`workflow_id = $${paramIndex}`);
    values.push(workflowId);
    paramIndex++;
  }

  if (startingAfter) {
    const cursorResult = await db.executeSql(
      'SELECT created_at FROM workflow_runs WHERE id = $1 LIMIT 1',
      [startingAfter],
    );
    if (cursorResult.rows[0]?.created_at) {
      conditions.push(`created_at < $${paramIndex}`);
      values.push(
        typeof cursorResult.rows[0].created_at === 'string'
          ? new Date(cursorResult.rows[0].created_at)
          : cursorResult.rows[0].created_at,
      );
      paramIndex++;
    }
  }

  if (endingBefore) {
    const cursorResult = await db.executeSql(
      'SELECT created_at FROM workflow_runs WHERE id = $1 LIMIT 1',
      [endingBefore],
    );
    if (cursorResult.rows[0]?.created_at) {
      conditions.push(`created_at > $${paramIndex}`);
      values.push(
        typeof cursorResult.rows[0].created_at === 'string'
          ? new Date(cursorResult.rows[0].created_at)
          : cursorResult.rows[0].created_at,
      );
      paramIndex++;
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const actualLimit = Math.min(Math.max(limit, 1), 100) + 1;

  const query = `
    SELECT * FROM workflow_runs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex}
  `;
  values.push(actualLimit);

  const result = await db.executeSql(query, values);
  const rows = result.rows;

  const hasMore = rows.length > (limit ?? 20);
  const rawItems = hasMore ? rows.slice(0, limit) : rows;
  const items = rawItems.map((row) => mapRowToWorkflowRun(row));
  const hasPrev = !!endingBefore;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1]?.id ?? null) : null;
  const prevCursor = hasPrev && items.length > 0 ? (items[0]?.id ?? null) : null;

  return { items, nextCursor, prevCursor, hasMore, hasPrev };
}

export async function withPostgresTransaction<T>(
  db: Db,
  callback: (db: Db) => Promise<T>,
): Promise<T> {
  try {
    await db.executeSql('BEGIN', []);
    const result = await callback(db);
    await db.executeSql('COMMIT', []);
    return result;
  } catch (error) {
    await db.executeSql('ROLLBACK', []);
    throw error;
  }
}
