import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let db: Database | null = null;
let dbPathOverride: string | null = null;

export function getDbPath(): string {
  if (dbPathOverride) return dbPathOverride;
  const dir = join(homedir(), ".fryler");
  mkdirSync(dir, { recursive: true });
  return join(dir, "fryler.db");
}

export function getDb(): Database {
  if (db) return db;

  db = new Database(getDbPath());
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','failed')),
      priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
      scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      result TEXT,
      cwd TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claude_session_id TEXT NOT NULL UNIQUE,
      title TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration: add cwd column to tasks for existing databases
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN cwd TEXT");
  } catch {
    // Column already exists
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Override the DB path for testing. Call before getDb(). */
export function _setDbPath(path: string | null): void {
  dbPathOverride = path;
}
