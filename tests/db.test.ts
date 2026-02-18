import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb, _setDbPath } from "@/db/index.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  getDueTasks,
  cancelTask,
} from "@/db/tasks.ts";
import { createMemory, listMemories, searchMemories } from "@/db/memories.ts";
import { createSession, getSession, updateSession, listSessions } from "@/db/sessions.ts";

const TEST_DB_PATH = join("/tmp", `fryler-test-${Date.now()}.db`);

beforeAll(() => {
  _setDbPath(TEST_DB_PATH);
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(TEST_DB_PATH);
    unlinkSync(TEST_DB_PATH + "-wal");
    unlinkSync(TEST_DB_PATH + "-shm");
  } catch {
    // ignore cleanup errors
  }
  _setDbPath(null);
});

describe("DB init", () => {
  test("creates all tables", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("tasks");
    expect(names).toContain("memories");
    expect(names).toContain("sessions");
  });
});

describe("Tasks", () => {
  test("create and get", () => {
    const task = createTask({ title: "Test task", description: "A test" });
    expect(task.id).toBeGreaterThan(0);
    expect(task.title).toBe("Test task");
    expect(task.description).toBe("A test");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe(3);
    expect(task.created_at).toBeTruthy();

    const fetched = getTask(task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Test task");
  });

  test("get returns null for missing id", () => {
    expect(getTask(99999)).toBeNull();
  });

  test("create with priority and scheduled_at", () => {
    const task = createTask({
      title: "Scheduled",
      priority: 1,
      scheduled_at: "2099-01-01 00:00:00",
    });
    expect(task.priority).toBe(1);
    expect(task.scheduled_at).toBe("2099-01-01 00:00:00");
  });

  test("list all and by status", () => {
    const all = listTasks();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const pending = listTasks("pending");
    for (const t of pending) {
      expect(t.status).toBe("pending");
    }
  });

  test("update status", () => {
    const task = createTask({ title: "To complete" });
    updateTaskStatus(task.id, "active");
    let updated = getTask(task.id)!;
    expect(updated.status).toBe("active");
    expect(updated.completed_at).toBeNull();

    updateTaskStatus(task.id, "completed", "done!");
    updated = getTask(task.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.completed_at).toBeTruthy();
    expect(updated.result).toBe("done!");
  });

  test("getDueTasks returns pending tasks with no or past scheduled_at", () => {
    const unscheduled = createTask({ title: "No schedule" });
    const pastDue = createTask({
      title: "Past due",
      scheduled_at: "2000-01-01 00:00:00",
    });
    const future = createTask({
      title: "Future",
      scheduled_at: "2099-12-31 23:59:59",
    });

    const due = getDueTasks();
    const dueIds = due.map((t) => t.id);
    expect(dueIds).toContain(unscheduled.id);
    expect(dueIds).toContain(pastDue.id);
    expect(dueIds).not.toContain(future.id);
  });

  test("cancelTask sets pending to failed", () => {
    const task = createTask({ title: "To cancel" });
    expect(cancelTask(task.id)).toBe(true);

    const cancelled = getTask(task.id)!;
    expect(cancelled.status).toBe("failed");
    expect(cancelled.completed_at).toBeTruthy();
  });

  test("cancelTask returns false for non-pending", () => {
    const task = createTask({ title: "Active task" });
    updateTaskStatus(task.id, "active");
    expect(cancelTask(task.id)).toBe(false);
  });

  test("create with cwd", () => {
    const task = createTask({
      title: "Repo task",
      cwd: "/home/fryler/.fryler/repos/myproject",
    });
    expect(task.cwd).toBe("/home/fryler/.fryler/repos/myproject");

    const fetched = getTask(task.id)!;
    expect(fetched.cwd).toBe("/home/fryler/.fryler/repos/myproject");
  });

  test("cwd defaults to null when not provided", () => {
    const task = createTask({ title: "No cwd task" });
    expect(task.cwd).toBeNull();
  });
});

describe("Memories", () => {
  test("create and list", () => {
    const mem = createMemory("test", "hello world", "unit-test");
    expect(mem.id).toBeGreaterThan(0);
    expect(mem.category).toBe("test");
    expect(mem.content).toBe("hello world");
    expect(mem.source).toBe("unit-test");

    createMemory("test", "another memory");
    createMemory("other", "different category");

    const all = listMemories();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list with category filter", () => {
    const testMems = listMemories("test");
    for (const m of testMems) {
      expect(m.category).toBe("test");
    }
    expect(testMems.length).toBeGreaterThanOrEqual(2);

    const otherMems = listMemories("other");
    for (const m of otherMems) {
      expect(m.category).toBe("other");
    }
  });

  test("search", () => {
    createMemory("search", "the quick brown fox");
    createMemory("search", "lazy dog sleeps");

    const results = searchMemories("brown fox");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain("brown fox");

    const noResults = searchMemories("xyznonexistent");
    expect(noResults.length).toBe(0);
  });
});

describe("Sessions", () => {
  test("create and get", () => {
    const session = createSession("sess-001", "First session");
    expect(session.id).toBeGreaterThan(0);
    expect(session.claude_session_id).toBe("sess-001");
    expect(session.title).toBe("First session");
    expect(session.message_count).toBe(0);

    const fetched = getSession("sess-001");
    expect(fetched).not.toBeNull();
    expect(fetched!.claude_session_id).toBe("sess-001");
  });

  test("get returns null for missing session", () => {
    expect(getSession("nonexistent")).toBeNull();
  });

  test("update session", () => {
    createSession("sess-002");
    updateSession("sess-002", 5);
    const after = getSession("sess-002")!;
    expect(after.message_count).toBe(5);
    expect(after.last_active_at).toBeTruthy();
  });

  test("list sessions ordered by last_active_at DESC", () => {
    createSession("sess-003");
    createSession("sess-004");
    // Update sess-003 so it has a more recent last_active_at
    updateSession("sess-003");

    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // sess-003 should appear before sess-004 since it was updated more recently
    const idx003 = sessions.findIndex((s) => s.claude_session_id === "sess-003");
    const idx004 = sessions.findIndex((s) => s.claude_session_id === "sess-004");
    expect(idx003).toBeLessThan(idx004);
  });
});
