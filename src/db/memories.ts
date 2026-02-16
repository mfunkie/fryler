import { getDb } from "./index.ts";

export interface Memory {
  id: number;
  category: string;
  content: string;
  source: string | null;
  created_at: string;
}

export function createMemory(category: string, content: string, source?: string): Memory {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO memories (category, content, source)
     VALUES ($category, $content, $source)`,
  );
  const result = stmt.run({
    $category: category,
    $content: content,
    $source: source ?? null,
  });
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM memories WHERE id = $id").get({
    $id: id,
  }) as Memory;
}

export function listMemories(category?: string): Memory[] {
  const db = getDb();
  if (category) {
    const stmt = db.prepare("SELECT * FROM memories WHERE category = $category");
    return stmt.all({ $category: category }) as Memory[];
  }
  return db.prepare("SELECT * FROM memories").all() as Memory[];
}

export function searchMemories(query: string): Memory[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM memories WHERE content LIKE $query");
  return stmt.all({ $query: `%${query}%` }) as Memory[];
}
