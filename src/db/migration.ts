import type { Db } from 'pg-boss';

// Arbitrary but stable lock ID for serializing migrations across processes
export const MIGRATION_LOCK_ID = 738291645;

// Bump this when adding new migrations. The engine stores the current version
// in a `workflow_schema_version` table so migrations only run once per version.
const CURRENT_SCHEMA_VERSION = 3;

export async function runMigrations(db: Db): Promise<void> {
  // Fast path: skip the advisory lock if schema is already current.
  // This is the common case - every engine.start() after initial setup.
  if (await isSchemaUpToDate(db)) {
    return;
  }

  // Slow path: build migration SQL based on current version, then execute
  // everything in a single transaction with an advisory lock.
  // This mirrors pg-boss's approach: one executeSql call ensures all DDL
  // runs on a single connection inside BEGIN/COMMIT, and pg_advisory_xact_lock
  // auto-releases on commit or rollback (no manual unlock needed).
  const currentVersion = await getCurrentVersion(db);

  const commands: string[] = [];

  if (currentVersion < 1) {
    commands.push(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id varchar(32) PRIMARY KEY NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        resource_id varchar(256),
        workflow_id varchar(256) NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        input jsonb NOT NULL,
        output jsonb,
        error text,
        current_step_id varchar(256) NOT NULL,
        timeline jsonb DEFAULT '{}'::jsonb NOT NULL,
        paused_at timestamp with time zone,
        resumed_at timestamp with time zone,
        completed_at timestamp with time zone,
        timeout_at timestamp with time zone,
        retry_count integer DEFAULT 0 NOT NULL,
        max_retries integer DEFAULT 0 NOT NULL,
        job_id varchar(256)
      )
    `);
    commands.push(`
      CREATE INDEX IF NOT EXISTS workflow_runs_created_at_idx ON workflow_runs USING btree (created_at)
    `);
    commands.push(`
      CREATE INDEX IF NOT EXISTS workflow_runs_resource_id_created_at_idx ON workflow_runs USING btree (resource_id, created_at DESC)
    `);
    commands.push(`
      CREATE INDEX IF NOT EXISTS workflow_runs_status_created_at_idx ON workflow_runs USING btree (status, created_at DESC)
    `);
    commands.push(`
      CREATE INDEX IF NOT EXISTS workflow_runs_workflow_id_created_at_idx ON workflow_runs USING btree (workflow_id, created_at DESC)
    `);
    commands.push(`
      CREATE INDEX IF NOT EXISTS workflow_runs_resource_id_workflow_id_created_at_idx ON workflow_runs USING btree (resource_id, workflow_id, created_at DESC)
    `);
  }

  if (currentVersion < 2) {
    commands.push('DROP INDEX IF EXISTS workflow_runs_workflow_id_idx');
    commands.push('DROP INDEX IF EXISTS workflow_runs_resource_id_idx');
    commands.push(
      'ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS idempotency_key varchar(256)',
    );
    commands.push(`
      CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_idempotency_key_idx ON workflow_runs (idempotency_key) WHERE idempotency_key IS NOT NULL
    `);
  }

  if (currentVersion < 3) {
    commands.push('ALTER TABLE workflow_runs ALTER COLUMN resource_id TYPE varchar(256)');
    commands.push('ALTER TABLE workflow_runs ALTER COLUMN workflow_id TYPE varchar(256)');
  }

  // Upsert the schema version
  if (currentVersion === 0) {
    commands.push(
      `INSERT INTO workflow_schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION})`,
    );
  } else {
    commands.push(`UPDATE workflow_schema_version SET version = ${CURRENT_SCHEMA_VERSION}`);
  }

  if (commands.length === 0) {
    return;
  }

  const sql = [
    'BEGIN',
    "SET LOCAL lock_timeout = '30s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`,
    'CREATE TABLE IF NOT EXISTS workflow_schema_version (version integer NOT NULL)',
    ...commands,
    'COMMIT',
  ].join(';\n');

  await db.executeSql(sql, []);
}

async function isSchemaUpToDate(db: Db): Promise<boolean> {
  try {
    const result = await db.executeSql('SELECT version FROM workflow_schema_version LIMIT 1', []);
    return (
      ((result.rows[0] as { version: number } | undefined)?.version ?? 0) >= CURRENT_SCHEMA_VERSION
    );
  } catch {
    // Table doesn't exist yet - needs migration
    return false;
  }
}

async function getCurrentVersion(db: Db): Promise<number> {
  try {
    const result = await db.executeSql('SELECT version FROM workflow_schema_version LIMIT 1', []);
    return (result.rows[0] as { version: number } | undefined)?.version ?? 0;
  } catch {
    return 0;
  }
}
