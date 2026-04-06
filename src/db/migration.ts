import type { Db } from 'pg-boss';

// Arbitrary but stable lock ID for serializing migrations across processes
export const MIGRATION_LOCK_ID = 738291645;

// Bump this when adding new migrations. The engine stores the current version
// in a `workflow_schema_version` table so migrations only run once per version.
const CURRENT_SCHEMA_VERSION = 2;

export async function runMigrations(db: Db): Promise<void> {
  // Fast path: skip the advisory lock if schema is already current.
  // This is the common case — every engine.start() after initial setup.
  if (await isSchemaUpToDate(db)) {
    return;
  }

  // Slow path: acquire advisory lock and run migrations.
  await db.executeSql('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

  try {
    await db.executeSql(
      'CREATE TABLE IF NOT EXISTS workflow_schema_version (version integer NOT NULL)',
      [],
    );

    const versionResult = await db.executeSql(
      'SELECT version FROM workflow_schema_version LIMIT 1',
      [],
    );
    const currentVersion = (versionResult.rows[0] as { version: number } | undefined)?.version ?? 0;

    // Re-check after acquiring lock — another process may have migrated while we waited
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      return;
    }

    // Version 0 → 1: Create the workflow_runs table and indexes
    if (currentVersion < 1) {
      await db.executeSql(
        `
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id varchar(32) PRIMARY KEY NOT NULL,
          created_at timestamp with time zone DEFAULT now() NOT NULL,
          updated_at timestamp with time zone DEFAULT now() NOT NULL,
          resource_id varchar(32),
          workflow_id varchar(32) NOT NULL,
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
        );
        `,
        [],
      );

      await db.executeSql(
        `
        CREATE INDEX IF NOT EXISTS workflow_runs_created_at_idx ON workflow_runs USING btree (created_at);
        CREATE INDEX IF NOT EXISTS workflow_runs_resource_id_created_at_idx ON workflow_runs USING btree (resource_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS workflow_runs_status_created_at_idx ON workflow_runs USING btree (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS workflow_runs_workflow_id_created_at_idx ON workflow_runs USING btree (workflow_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS workflow_runs_resource_id_workflow_id_created_at_idx ON workflow_runs USING btree (resource_id, workflow_id, created_at DESC);
        `,
        [],
      );
    }

    // Version 1 → 2: Drop legacy single-column indexes,
    // add idempotency_key column and unique index.
    if (currentVersion < 2) {
      await db.executeSql(
        `
        DROP INDEX IF EXISTS workflow_runs_workflow_id_idx;
        DROP INDEX IF EXISTS workflow_runs_resource_id_idx;
        ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS idempotency_key varchar(256);
        CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_idempotency_key_idx ON workflow_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
        `,
        [],
      );
    }

    // Upsert the schema version
    if (currentVersion === 0) {
      await db.executeSql('INSERT INTO workflow_schema_version (version) VALUES ($1)', [
        CURRENT_SCHEMA_VERSION,
      ]);
    } else {
      await db.executeSql('UPDATE workflow_schema_version SET version = $1', [
        CURRENT_SCHEMA_VERSION,
      ]);
    }
  } finally {
    await db.executeSql('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  }
}

async function isSchemaUpToDate(db: Db): Promise<boolean> {
  try {
    const result = await db.executeSql('SELECT version FROM workflow_schema_version LIMIT 1', []);
    return (
      ((result.rows[0] as { version: number } | undefined)?.version ?? 0) >= CURRENT_SCHEMA_VERSION
    );
  } catch {
    // Table doesn't exist yet — needs migration
    return false;
  }
}
