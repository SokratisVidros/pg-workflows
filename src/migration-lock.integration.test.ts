import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_LOCK_ID, runMigrations } from './db/migration';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pg_workflows_test';

let pool: pg.Pool;

function makeDb(client: pg.PoolClient) {
  return {
    executeSql: (text: string, values?: unknown[]) =>
      client.query(text, values) as Promise<{ rows: unknown[] }>,
  };
}

describe('Migration advisory lock (real PostgreSQL)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    await pool.query('SELECT 1');
  });

  afterEach(async () => {
    // Reset schema state between tests so each test starts from a clean slate
    await pool.query('DROP TABLE IF EXISTS workflow_runs CASCADE');
    await pool.query('DROP TABLE IF EXISTS workflow_schema_version CASCADE');
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('should serialize concurrent migrations with advisory lock instead of deadlocking', async () => {
    // Run 5 concurrent migrations — before the advisory lock fix,
    // this would deadlock when multiple processes ran DDL concurrently.
    const concurrency = 5;
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, async () => {
        const client = await pool.connect();
        try {
          const db = makeDb(client);
          await runMigrations(db);
        } finally {
          client.release();
        }
      }),
    );

    // All migrations should succeed (no deadlocks)
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }

    // Verify the final schema state is correct
    const versionResult = await pool.query('SELECT version FROM workflow_schema_version LIMIT 1');
    expect(versionResult.rows[0].version).toBe(2);

    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'workflow_runs'
      )
    `);
    expect(tableExists.rows[0].exists).toBe(true);
  });

  it('should skip migrations on subsequent starts when schema is up to date', async () => {
    const client = await pool.connect();
    try {
      const db = makeDb(client);

      // First run: performs full migration
      await runMigrations(db);

      // Verify the table and version were created
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'workflow_runs'
        )
      `);
      expect(tableExists.rows[0].exists).toBe(true);

      // Second run: should be a no-op via the fast path (version check before lock)
      let queryCount = 0;
      const trackingDb = {
        executeSql: async (text: string, values?: unknown[]) => {
          queryCount++;
          return client.query(text, values) as Promise<{ rows: unknown[] }>;
        },
      };
      await runMigrations(trackingDb);

      // Fast path: only runs SELECT version → finds schema is current → returns
      expect(queryCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it('should release the advisory lock after migration completes', async () => {
    const client = await pool.connect();
    try {
      const db = makeDb(client);
      await runMigrations(db);

      // The lock should be released — try_advisory_lock should succeed immediately
      const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        MIGRATION_LOCK_ID,
      ]);
      expect(result.rows[0].acquired).toBe(true);

      // Clean up
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  });

  it('should release the advisory lock even if migration fails', async () => {
    const client = await pool.connect();
    try {
      let callCount = 0;
      const db = {
        executeSql: async (text: string, values?: unknown[]) => {
          callCount++;
          // Let the fast-path check (1), advisory lock (2), and version table setup (3) through,
          // then fail on the 4th call (version SELECT inside the lock)
          if (callCount === 4) {
            throw new Error('Simulated migration failure');
          }
          return client.query(text, values) as Promise<{ rows: unknown[] }>;
        },
      };

      await expect(runMigrations(db)).rejects.toThrow('Simulated migration failure');

      // The advisory lock should still be released thanks to the finally block
      const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        MIGRATION_LOCK_ID,
      ]);
      expect(result.rows[0].acquired).toBe(true);

      // Clean up
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  });
});
