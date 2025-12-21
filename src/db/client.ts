import pg from 'pg';
import { parse } from 'pg-connection-string';

const { Pool } = pg;

let poolClient: pg.Pool | null = null;

export function getPostgresClient(): pg.Pool {
  if (poolClient) {
    return poolClient;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const config = parse(databaseUrl);

  poolClient = new Pool({
    host: config.host ?? 'localhost',
    port: config.port ? Number(config.port) : 5432,
    database: config.database ?? undefined,
    user: config.user ?? undefined,
    password: config.password ?? undefined,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });

  return poolClient;
}

export async function closePostgresClient(): Promise<void> {
  if (poolClient) {
    await poolClient.end();
    poolClient = null;
  }
}

// Transaction support
export type PostgresTransaction = pg.PoolClient;

export async function withPostgresTransaction<T>(
  callback: (tx: PostgresTransaction) => Promise<T>,
): Promise<T> {
  const pool = getPostgresClient();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
