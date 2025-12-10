import { createClient } from '@clickhouse/client';

// Default client for migrations and initial setup
export const clickhouseDefault = createClient({
  host: process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: 'default', // Always connect to default database first
});

// Main client for application use (assumes gigz database exists)
export const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'gigz',
});

// Type-safe query helpers
export async function query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  });
  return result.json<T>() as Promise<T[]>;
}

export async function insert<T extends Record<string, unknown>>(
  table: string,
  values: T[]
): Promise<void> {
  await clickhouse.insert({
    table,
    values,
    format: 'JSONEachRow',
  });
}

// Execute SQL without returning data (for DDL statements)
export async function exec(sql: string): Promise<void> {
  await clickhouse.exec({
    query: sql,
  });
}

// Execute SQL on default database (for migrations)
export async function execDefault(sql: string): Promise<void> {
  await clickhouseDefault.exec({
    query: sql,
  });
}