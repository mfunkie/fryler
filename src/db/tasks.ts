import { getDb } from "./index.ts";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: "pending" | "active" | "completed" | "failed";
  priority: number;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  result: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  scheduled_at?: string | null;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO tasks (title, description, priority, scheduled_at)
     VALUES ($title, $description, $priority, $scheduled_at)`,
  );
  const result = stmt.run({
    $title: input.title,
    $description: input.description ?? "",
    $priority: input.priority ?? 3,
    $scheduled_at: input.scheduled_at ?? null,
  });
  return getTask(Number(result.lastInsertRowid))!;
}

export function getTask(id: number): Task | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM tasks WHERE id = $id");
  return (stmt.get({ $id: id }) as Task) ?? null;
}

export function listTasks(status?: Task["status"]): Task[] {
  const db = getDb();
  if (status) {
    const stmt = db.prepare("SELECT * FROM tasks WHERE status = $status");
    return stmt.all({ $status: status }) as Task[];
  }
  return db.prepare("SELECT * FROM tasks").all() as Task[];
}

export function updateTaskStatus(id: number, status: Task["status"], result?: string): void {
  const db = getDb();
  const completedAt =
    status === "completed" || status === "failed" ? "datetime('now')" : "completed_at";
  const stmt = db.prepare(
    `UPDATE tasks
     SET status = $status,
         result = COALESCE($result, result),
         updated_at = datetime('now'),
         completed_at = ${completedAt}
     WHERE id = $id`,
  );
  stmt.run({ $id: id, $status: status, $result: result ?? null });
}

export function getDueTasks(): Task[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT * FROM tasks
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))`,
  );
  return stmt.all() as Task[];
}

export function cancelTask(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE tasks SET status = 'failed', updated_at = datetime('now'), completed_at = datetime('now')
     WHERE id = $id AND status = 'pending'`,
  );
  const result = stmt.run({ $id: id });
  return result.changes > 0;
}
