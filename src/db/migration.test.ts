import type pg from 'pg';
import type { Db } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, createTestDatabase } from '../tests/test-db';
import { runMigrations } from './migration';

const CURRENT_SCHEMA_VERSION = 6;

describe('runMigrations', () => {
  let pool: pg.Pool;
  let db: Db;

  beforeEach(async () => {
    pool = await createTestDatabase();
    db = {
      executeSql: (text: string, values?: unknown[]) =>
        pool.query(text, values) as Promise<{ rows: unknown[] }>,
    };
  });

  afterEach(async () => {
    await closeTestDatabase();
  });

  const tableExists = async (name: string): Promise<boolean> => {
    const result = await db.executeSql(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
      [name],
    );
    return result.rows.length > 0;
  };

  const schemaVersion = async (): Promise<number> => {
    const result = await db.executeSql('SELECT version FROM workflow_schema_version LIMIT 1', []);
    return (result.rows[0] as { version: number }).version;
  };

  it('migrates a fresh database to the current schema version', async () => {
    await runMigrations(db);

    expect(await tableExists('workflow_runs')).toBe(true);
    expect(await tableExists('workflow_schema_version')).toBe(true);
    expect(await schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('adds a non-null priority column defaulting to 0', async () => {
    await runMigrations(db);

    const result = await db.executeSql(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'workflow_runs' AND column_name = 'priority'`,
      [],
    );

    expect(result.rows).toHaveLength(1);
    const col = result.rows[0] as {
      data_type: string;
      is_nullable: string;
      column_default: string;
    };
    expect(col.data_type).toBe('integer');
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default).toBe('0');
  });

  it('is idempotent when run repeatedly', async () => {
    await runMigrations(db);
    await runMigrations(db); // second run hits the fast path, must not throw
    await runMigrations(db);

    expect(await schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('throws when a foreign workflow_runs table already exists', async () => {
    // Simulate a consumer who already has their own unrelated workflow_runs table.
    await db.executeSql('CREATE TABLE workflow_runs (id integer PRIMARY KEY, my_col text)', []);

    await expect(runMigrations(db)).rejects.toThrow(
      /already exists in this schema but was not created by pg-workflows/,
    );

    // The guard must fire before any DDL: no version table, and the foreign
    // table must be left untouched (still has its original column).
    expect(await tableExists('workflow_schema_version')).toBe(false);
    const cols = await db.executeSql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'workflow_runs'`,
      [],
    );
    const columnNames = cols.rows.map((r) => (r as { column_name: string }).column_name);
    expect(columnNames).toContain('my_col');
    expect(columnNames).not.toContain('idempotency_key'); // proves no ALTER ran
  });
});
