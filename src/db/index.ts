import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const dbPath = path.join(process.cwd(), 'assistant.db');
export const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

try {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder });
} catch (err) {
  console.error('[DB] Auto-migration error on database init:', err);
}

