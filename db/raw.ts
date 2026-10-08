import { Pool } from "pg";

const globalPool = globalThis as typeof globalThis & { ai402Pool?: Pool };

export function database(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  if (!globalPool.ai402Pool) {
    globalPool.ai402Pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalPool.ai402Pool;
}
