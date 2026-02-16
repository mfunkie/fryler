import { getDb } from "./index.ts";

export interface Session {
  id: number;
  claude_session_id: string;
  title: string | null;
  started_at: string;
  last_active_at: string;
  message_count: number;
}

export function createSession(
  claude_session_id: string,
  title?: string,
): Session {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO sessions (claude_session_id, title)
     VALUES ($claude_session_id, $title)`,
  );
  const result = stmt.run({
    $claude_session_id: claude_session_id,
    $title: title ?? null,
  });
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM sessions WHERE id = $id").get({
    $id: id,
  }) as Session;
}

export function getSession(claude_session_id: string): Session | null {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM sessions WHERE claude_session_id = $claude_session_id",
  );
  return (
    (stmt.get({ $claude_session_id: claude_session_id }) as Session) ?? null
  );
}

export function updateSession(
  claude_session_id: string,
  message_count?: number,
): void {
  const db = getDb();
  if (message_count !== undefined) {
    const stmt = db.prepare(
      `UPDATE sessions
       SET last_active_at = datetime('now'), message_count = $message_count
       WHERE claude_session_id = $claude_session_id`,
    );
    stmt.run({
      $claude_session_id: claude_session_id,
      $message_count: message_count,
    });
  } else {
    const stmt = db.prepare(
      `UPDATE sessions
       SET last_active_at = datetime('now')
       WHERE claude_session_id = $claude_session_id`,
    );
    stmt.run({ $claude_session_id: claude_session_id });
  }
}

export function listSessions(): Session[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM sessions ORDER BY last_active_at DESC")
    .all() as Session[];
}
