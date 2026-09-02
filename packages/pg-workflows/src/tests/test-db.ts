import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';

let testDb: PGlite | null = null;

export async function createTestDatabase(): Promise<pg.Pool> {
  testDb = new PGlite();

  const execQuery = async (text: string, params?: unknown[]) => {
    if (!testDb) throw new Error('Test database not initialized');
    // PGlite's query() doesn't support multi-statement SQL.
    // pg-boss v12 sends multi-statement SQL via locked() wrappers (BEGIN; SET LOCAL ...; COMMIT;).
    // Detect these and use exec() instead, which supports multi-statement but not parameters.
    // Flatten every statement's rows so a RETURNING in the middle of a locked() block isn't
    // dropped behind a trailing COMMIT (mirrors pg-boss's own fromPglite adapter).
    try {
      const isMultiStatement =
        text.includes(';') &&
        text
          .trim()
          .replace(/;[\s]*$/, '')
          .includes(';');
      if (isMultiStatement && (!params || params.length === 0)) {
        const results = await testDb.exec(text);
        const rows = results.flatMap((r) => r.rows ?? []);
        const last = results[results.length - 1];
        return {
          rows,
          rowCount: rows.length,
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
    } catch (error) {
      // A failed statement inside BEGIN...COMMIT leaves PGlite's single connection aborted;
      // roll back so later queries aren't poisoned.
      await testDb.query('ROLLBACK').catch(() => {});
      throw error;
    }
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
