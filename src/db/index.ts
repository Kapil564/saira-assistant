import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getAppPaths, ensureUserDataDirectories } from '../shared/paths';
import * as schema from './schema';

// Guarantee per-user AppData directory exists
ensureUserDataDirectories();

const paths = getAppPaths();
console.log(`[DB] Connecting to per-user SQLite database at: ${paths.dbPath}`);

export const sqlite = new Database(paths.dbPath);
export const db = drizzle(sqlite, { schema });

try {
  migrate(db, { migrationsFolder: paths.migrationsFolder });
  console.log('[DB] Auto-migration check completed successfully.');
} catch (err) {
  console.error('[DB] Auto-migration error on database init:', err);
}
