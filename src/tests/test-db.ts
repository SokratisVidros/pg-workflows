import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';

let testDb: PGlite | null = null;

export async function createTestDatabase(): Promise<pg.Pool> {
  testDb = new PGlite();

  await migratePgBoss(testDb);

  const execQuery = async (text: string, params?: unknown[]) => {
    if (!testDb) throw new Error('Test database not initialized');
    // PGlite's query() doesn't support multi-statement SQL.
    // pg-boss v12 sends multi-statement SQL via locked() wrappers (BEGIN; SET LOCAL ...; COMMIT;).
    // Detect these and use exec() instead, which supports multi-statement but not parameters.
    const isMultiStatement =
      text.includes(';') &&
      text
        .trim()
        .replace(/;[\s]*$/, '')
        .includes(';');
    if (isMultiStatement && (!params || params.length === 0)) {
      const results = await testDb.exec(text);
      const last = results[results.length - 1];
      return {
        rows: last?.rows ?? [],
        rowCount: last?.rows?.length ?? 0,
        command: '',
        oid: 0,
        fields: last?.fields ?? [],
      };
    }
    const result = await testDb.query(text, params);
    return {
      rows: result.rows,
      rowCount: result.rows.length,
      command: '',
      oid: 0,
      fields: result.fields,
    };
  };

  const poolLike = {
    query: execQuery,
    connect: async () => {
      return {
        query: execQuery,
        release: () => {
          // No-op for PGLite
        },
      };
    },
    end: async () => {
      if (testDb) {
        await testDb.close();
        testDb = null;
      }
    },
  } as unknown as pg.Pool;

  return poolLike;
}

export async function closeTestDatabase(): Promise<void> {
  if (testDb) {
    await testDb.close();
    testDb = null;
  }
}

export function getTestDatabase(): PGlite | null {
  return testDb;
}

/**
 * Run PgBoss V12 migrations for PGLite. This is a copy of the migrations from the pgboss package
 * but modified to run in separate statements as PGLite does not support running multiple statements
 * in a single exec call.
 */
async function migratePgBoss(db: PGlite): Promise<void> {
  await db.exec('CREATE SCHEMA IF NOT EXISTS pgboss');

  await db.exec(`CREATE TYPE pgboss.job_state AS ENUM (
        'created',
        'retry',
        'active',
        'completed',
        'cancelled',
        'failed'
      )`);

  await db.exec(`CREATE TABLE pgboss.version (
        version int primary key,
        cron_on timestamp with time zone,
        bam_on timestamp with time zone
      )`);

  await db.exec(`CREATE TABLE pgboss.queue (
        name text NOT NULL,
        policy text NOT NULL,
        retry_limit int NOT NULL,
        retry_delay int NOT NULL,
        retry_backoff bool NOT NULL,
        retry_delay_max int,
        expire_seconds int NOT NULL,
        retention_seconds int NOT NULL,
        deletion_seconds int NOT NULL,
        dead_letter text REFERENCES pgboss.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
        partition bool NOT NULL,
        table_name text NOT NULL,
        deferred_count int NOT NULL default 0,
        queued_count int NOT NULL default 0,
        warning_queued int NOT NULL default 0,
        active_count int NOT NULL default 0,
        total_count int NOT NULL default 0,
        singletons_active text[],
        monitor_on timestamp with time zone,
        maintain_on timestamp with time zone,
        created_on timestamp with time zone not null default now(),
        updated_on timestamp with time zone not null default now(),
        PRIMARY KEY (name)
      )`);

  await db.exec(`CREATE TABLE pgboss.schedule (
        name text REFERENCES pgboss.queue ON DELETE CASCADE,
        key text not null DEFAULT '',
        cron text not null,
        timezone text,
        data jsonb,
        options jsonb,
        created_on timestamp with time zone not null default now(),
        updated_on timestamp with time zone not null default now(),
        PRIMARY KEY (name, key)
      )`);

  await db.exec(`CREATE TABLE pgboss.subscription (
        event text not null,
        name text not null REFERENCES pgboss.queue ON DELETE CASCADE,
        created_on timestamp with time zone not null default now(),
        updated_on timestamp with time zone not null default now(),
        PRIMARY KEY(event, name)
      )`);

  await db.exec(`CREATE TABLE pgboss.bam (
        id uuid PRIMARY KEY default gen_random_uuid(),
        name text NOT NULL,
        version int NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        queue text,
        table_name text NOT NULL,
        command text NOT NULL,
        error text,
        created_on timestamp with time zone NOT NULL DEFAULT now(),
        started_on timestamp with time zone,
        completed_on timestamp with time zone
      )`);

  await db.exec(`CREATE TABLE pgboss.job (
        id uuid not null default gen_random_uuid(),
        name text not null,
        priority integer not null default(0),
        data jsonb,
        state pgboss.job_state not null default 'created',
        retry_limit integer not null default 2,
        retry_count integer not null default 0,
        retry_delay integer not null default 0,
        retry_backoff boolean not null default false,
        retry_delay_max integer,
        expire_seconds int not null default 900,
        deletion_seconds int not null default 604800,
        singleton_key text,
        singleton_on timestamp without time zone,
        group_id text,
        group_tier text,
        start_after timestamp with time zone not null default now(),
        created_on timestamp with time zone not null default now(),
        started_on timestamp with time zone,
        completed_on timestamp with time zone,
        keep_until timestamp with time zone NOT NULL default now() + interval '604800',
        output jsonb,
        dead_letter text,
        policy text
      ) PARTITION BY LIST (name)`);

  await db.exec('ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)');

  // Create common job table (non-partitioned jobs go here)
  await db.exec('CREATE TABLE pgboss.job_common (LIKE pgboss.job INCLUDING DEFAULTS)');
  await db.exec('ALTER TABLE pgboss.job_common ADD PRIMARY KEY (name, id)');
  await db.exec(
    `ALTER TABLE pgboss.job_common ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`,
  );
  await db.exec(
    `ALTER TABLE pgboss.job_common ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX job_common_i1 ON pgboss.job_common (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX job_common_i2 ON pgboss.job_common (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX job_common_i3 ON pgboss.job_common (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX job_common_i4 ON pgboss.job_common (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL`,
  );
  await db.exec(
    `CREATE INDEX job_common_i5 ON pgboss.job_common (name, start_after) INCLUDE (priority, created_on, id) WHERE state < 'active'`,
  );
  await db.exec(
    `CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'`,
  );
  await db.exec(
    `CREATE INDEX job_common_i7 ON pgboss.job_common (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL`,
  );
  await db.exec(`ALTER TABLE pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT`);

  await db.exec(`CREATE TABLE pgboss.warning (
        id uuid PRIMARY KEY default gen_random_uuid(),
        type text NOT NULL,
        message text NOT NULL,
        data jsonb,
        created_on timestamp with time zone NOT NULL DEFAULT now()
      )`);
  await db.exec('CREATE INDEX warning_i1 ON pgboss.warning (created_on DESC)');

  await db.exec(`
      CREATE FUNCTION pgboss.job_table_format(command text, table_name text)
      RETURNS text AS
      $$
        SELECT format(
          replace(
            replace(command, '.job', '.%1$I'),
            'job_i', '%1$s_i'
          ),
          table_name
        );
      $$
      LANGUAGE sql IMMUTABLE;
    `);

  await db.exec(`
      CREATE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
      RETURNS VOID AS
      $$
      DECLARE
        tbl RECORD;
      BEGIN
        IF queue_name IS NOT NULL THEN
          SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
        END IF;

        IF tbl_name IS NOT NULL THEN
          EXECUTE pgboss.job_table_format(command, tbl_name);
          RETURN;
        END IF;

        EXECUTE pgboss.job_table_format(command, 'job_common');

        FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
        LOOP
          EXECUTE pgboss.job_table_format(command, tbl.table_name);
        END LOOP;
      END;
      $$
      LANGUAGE plpgsql;
    `);

  await db.exec(`
      CREATE FUNCTION pgboss.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
      RETURNS VOID AS
      $$
      BEGIN
        IF queue_name IS NOT NULL THEN
          SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
        END IF;

        IF tbl_name IS NOT NULL THEN
          INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
          VALUES (command_name, version, 'pending', queue_name, tbl_name, pgboss.job_table_format(command, tbl_name));
          RETURN;
        END IF;

        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        SELECT command_name, version, 'pending', NULL, 'job_common', pgboss.job_table_format(command, 'job_common')
        UNION ALL
        SELECT command_name, version, 'pending', queue.name, queue.table_name, pgboss.job_table_format(command, queue.table_name)
        FROM pgboss.queue WHERE partition = true;
      END;
      $$
      LANGUAGE plpgsql;
    `);

  await db.exec(`
      CREATE FUNCTION pgboss.create_queue(queue_name text, options jsonb)
      RETURNS VOID AS
      $$
      DECLARE
        tablename varchar := CASE WHEN options->>'partition' = 'true'
                              THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                              ELSE 'job_common'
                              END;
        queue_created_on timestamptz;
      BEGIN

        WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
        )
        SELECT created_on into queue_created_on from q;

        IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
          RETURN;
        END IF;

        EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

        EXECUTE format('ALTER TABLE pgboss.%1$I ADD PRIMARY KEY (name, id)', tablename);
        EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', tablename);
        EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', tablename);
        EXECUTE format('CREATE INDEX %1$s_i5 ON pgboss.%1$I (name, start_after) INCLUDE (priority, created_on, id) WHERE state < ''active''', tablename);
        EXECUTE format('CREATE UNIQUE INDEX %1$s_i4 ON pgboss.%1$I (name, singleton_on, COALESCE(singleton_key, '''')) WHERE state <> ''cancelled'' AND singleton_on IS NOT NULL', tablename);
        EXECUTE format('CREATE INDEX %1$s_i7 ON pgboss.%1$I (name, group_id) WHERE state = ''active'' AND group_id IS NOT NULL', tablename);

        IF options->>'policy' = 'short' THEN
          EXECUTE format('CREATE UNIQUE INDEX %1$s_i1 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''created'' AND policy = ''short''', tablename);
        ELSIF options->>'policy' = 'singleton' THEN
          EXECUTE format('CREATE UNIQUE INDEX %1$s_i2 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''active'' AND policy = ''singleton''', tablename);
        ELSIF options->>'policy' = 'stately' THEN
          EXECUTE format('CREATE UNIQUE INDEX %1$s_i3 ON pgboss.%1$I (name, state, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''stately''', tablename);
        ELSIF options->>'policy' = 'exclusive' THEN
          EXECUTE format('CREATE UNIQUE INDEX %1$s_i6 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''exclusive''', tablename);
        ELSIF options->>'policy' = 'key_strict_fifo' THEN
          EXECUTE format('CREATE UNIQUE INDEX %1$s_i8 ON pgboss.%1$I (name, singleton_key) WHERE state IN (''active'', ''retry'', ''failed'') AND policy = ''key_strict_fifo''', tablename);
          EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = ''key_strict_fifo'' AND singleton_key IS NULL))', tablename);
        END IF;

        EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
        EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
      END;
      $$
      LANGUAGE plpgsql;
    `);

  await db.exec(`
      CREATE FUNCTION pgboss.delete_queue(queue_name text)
      RETURNS VOID AS
      $$
      DECLARE
        v_table varchar;
        v_partition bool;
      BEGIN
        SELECT table_name, partition FROM pgboss.queue WHERE name = queue_name INTO v_table, v_partition;

        IF v_partition THEN
          EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
        ELSE
          EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
        END IF;

        DELETE FROM pgboss.queue WHERE name = queue_name;
      END;
      $$
      LANGUAGE plpgsql;
    `);

  await db.exec(`INSERT INTO pgboss.version(version) VALUES (29)`);
}
