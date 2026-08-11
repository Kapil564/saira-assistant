import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolves the OS-appropriate per-user app data directory:
 * - Electron main process: app.getPath('userData')
 * - Fallback (CLI / non-Electron / node process): %APPDATA%\Saira on Windows
 *   or ~/.config/saira on Linux/macOS
 */
export function getUserDataDir(): string {
  // If running inside Electron main process
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // Not running in Electron main process
  }

  // Windows per-user AppData environment variable
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Saira');
  }

  // Fallback using os.homedir()
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Saira');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Saira');
  }
  return path.join(home, '.config', 'saira');
}

export interface AppPaths {
  userDataDir: string;
  dbPath: string;
  memoryDir: string;
  profileMdPath: string;
  archiveDir: string;
  migrationsFolder: string;
}

/**
 * Returns absolute per-user storage paths derived from getUserDataDir().
 */
export function getAppPaths(): AppPaths {
  const userDataDir = getUserDataDir();

  // Find Drizzle migrations folder location (dev vs prod bundle)
  let migrationsFolder = path.join(process.cwd(), 'drizzle');
  if (!fs.existsSync(migrationsFolder)) {
    const parentFolder = path.join(__dirname, '..', 'drizzle');
    if (fs.existsSync(parentFolder)) {
      migrationsFolder = parentFolder;
    }
  }

  return {
    userDataDir,
    dbPath: path.join(userDataDir, 'assistant.db'),
    memoryDir: path.join(userDataDir, 'memory'),
    profileMdPath: path.join(userDataDir, 'memory', 'profile.md'),
    archiveDir: path.join(userDataDir, 'archive', 'sessions'),
    migrationsFolder,
  };
}

/**
 * Ensures per-user application directories exist on local disk.
 */
export function ensureUserDataDirectories(): void {
  const paths = getAppPaths();
  if (!fs.existsSync(paths.userDataDir)) {
    fs.mkdirSync(paths.userDataDir, { recursive: true });
  }
  if (!fs.existsSync(paths.memoryDir)) {
    fs.mkdirSync(paths.memoryDir, { recursive: true });
  }
  if (!fs.existsSync(paths.archiveDir)) {
    fs.mkdirSync(paths.archiveDir, { recursive: true });
  }
}
