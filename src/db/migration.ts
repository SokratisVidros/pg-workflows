import type { Db } from 'pg-boss';

export async function runMigrations(db: Db): Promise<void> {
  const tableExistsResult = await db.executeSql(
    `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'workflow_runs'
    );
  `,
    [],
  );

  if (!tableExistsResult.rows[0]?.exists) {
    await db.executeSql(
      `
      CREATE TABLE workflow_runs (
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
      CREATE INDEX workflow_runs_created_at_idx ON workflow_runs USING btree (created_at);
      CREATE INDEX workflow_runs_resource_id_created_at_idx ON workflow_runs USING btree (resource_id, created_at DESC);
      CREATE INDEX workflow_runs_status_created_at_idx ON workflow_runs USING btree (status, created_at DESC);
      CREATE INDEX workflow_runs_workflow_id_created_at_idx ON workflow_runs USING btree (workflow_id, created_at DESC);
      CREATE INDEX workflow_runs_resource_id_workflow_id_created_at_idx ON workflow_runs USING btree (resource_id, workflow_id, created_at DESC);
    `,
      [],
    )
  }
}
