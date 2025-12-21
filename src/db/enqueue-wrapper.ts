import type pg from 'pg';
import type PgBoss from 'pg-boss';

/**
 * Custom database executor for PgBoss with pg transaction
 */
type PostgresDbExecutor = {
  executeSql: (text: string, values: unknown[]) => Promise<unknown>;
};

/**
 * Extended PgBoss send options with db property
 */
type PgBossSendOptionsWithDb = PgBoss.SendOptions & {
  db?: PostgresDbExecutor;
};

/**
 * Wrapper to enqueue jobs using pg transaction
 * This mimics the pg-boss API but works with pg transactions
 */
export async function enqueueWithPostgres(
  boss: PgBoss,
  queueName: string,
  data: object,
  options: {
    tx?: pg.PoolClient;
    startAfter?: Date;
    expireInSeconds?: number;
  },
): Promise<string | null> {
  const { startAfter, tx, expireInSeconds = 60 } = options;

  if (tx) {
    // When using a transaction, we need to pass the pg client
    const options: PgBossSendOptionsWithDb = {
      startAfter,
      expireInSeconds,
      db: {
        executeSql: async (text: string, values: unknown[]) => {
          // Use the pg transaction to execute the query
          const result = await tx.query(text, values);
          return result;
        },
      },
    };
    return boss.send(queueName, data, options);
  }

  // Without transaction, just use normal send
  return boss.send(queueName, data, {
    startAfter,
    expireInSeconds,
  });
}
