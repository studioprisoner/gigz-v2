import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { clickhouseDefault, clickhouse } from './client';

interface Migration {
  version: number;
  filename: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  return files.map(filename => {
    const versionMatch = filename.match(/^(\d+)_/);
    if (!versionMatch) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const version = parseInt(versionMatch[1], 10);
    const sql = readFileSync(join(migrationsDir, filename), 'utf-8');

    return { version, filename, sql };
  });
}

export async function migrate(): Promise<void> {
  const migrations = loadMigrations();

  console.log(`Found ${migrations.length} migrations to run...`);

  for (const migration of migrations) {
    try {
      console.log(`Running migration ${migration.version}: ${migration.filename}`);

      // Split SQL by semicolon and execute each statement
      const statements = migration.sql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        // Use default client for database creation, then switch to main client
        if (migration.version === 1) {
          await clickhouseDefault.exec({ query: statement });
        } else {
          await clickhouse.exec({ query: statement });
        }
      }

      console.log(`✅ Migration ${migration.version} completed successfully`);
    } catch (error) {
      console.error(`❌ Migration ${migration.version} failed:`, error);
      throw error;
    }
  }

  console.log('🎉 All migrations completed successfully!');
}

// Run migrations if this file is executed directly
if (import.meta.main) {
  migrate().catch(console.error);
}