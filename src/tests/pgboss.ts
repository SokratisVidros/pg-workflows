import type pg from 'pg';
import { type Db, PgBoss } from 'pg-boss';

let bossInstance: PgBoss | null = null;

function wrapPool(pool: pg.Pool): Db {
  return {
    executeSql: async (text: string, values?: unknown[]) => pool.query(text, values),
  };
}

export async function getBoss(db?: pg.Pool): Promise<PgBoss> {
  if (bossInstance) {
    return bossInstance;
  }

  if (!db) {
    throw new Error('Database pool is required to create PgBoss instance');
  }

  const boss = new PgBoss({
    db: wrapPool(db),
    migrate: false,
  });

  bossInstance = boss;

  return boss;
}
