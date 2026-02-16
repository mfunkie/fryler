import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, closeDb, _setDbPath } from "@/db/index.ts";
import { createTask, getTask, getDueTasks, updateTaskStatus } from "@/db/tasks.ts";
import {
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatRunning,
} from "@/daemon/heartbeat.ts";

const TEST_DB_PATH = join("/tmp", `fryler-heartbeat-test-${Date.now()}.db`);

beforeAll(() => {
  _setDbPath(TEST_DB_PATH);
  getDb();
});

afterEach(() => {
  stopHeartbeat();
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

describe("Heartbeat lifecycle", () => {
  test("isHeartbeatRunning returns false initially", () => {
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("startHeartbeat sets running to true", () => {
    startHeartbeat(60_000);
    expect(isHeartbeatRunning()).toBe(true);
  });

  test("stopHeartbeat sets running to false", () => {
    startHeartbeat(60_000);
    expect(isHeartbeatRunning()).toBe(true);
    stopHeartbeat();
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("stopHeartbeat is safe to call when not running", () => {
    expect(isHeartbeatRunning()).toBe(false);
    stopHeartbeat();
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("double start warns but doesn't crash", () => {
    startHeartbeat(60_000);
    startHeartbeat(60_000); // should warn, not crash
    expect(isHeartbeatRunning()).toBe(true);
  });
});

describe("Heartbeat task DB operations", () => {
  test("getDueTasks returns pending tasks", () => {
    const task = createTask({ title: "Due task" });
    const due = getDueTasks();
    expect(due.some(t => t.id === task.id)).toBe(true);
  });

  test("getDueTasks excludes future-scheduled tasks", () => {
    const task = createTask({
      title: "Future task",
      scheduled_at: "2099-01-01T00:00:00",
    });
    const due = getDueTasks();
    expect(due.some(t => t.id === task.id)).toBe(false);
  });

  test("updateTaskStatus transitions pending to active", () => {
    const task = createTask({ title: "Transition test" });
    updateTaskStatus(task.id, "active");
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("active");
  });

  test("updateTaskStatus transitions active to completed with result", () => {
    const task = createTask({ title: "Complete test" });
    updateTaskStatus(task.id, "active");
    updateTaskStatus(task.id, "completed", "Done!");
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("Done!");
    expect(updated.completed_at).toBeTruthy();
  });

  test("updateTaskStatus transitions active to failed with error", () => {
    const task = createTask({ title: "Fail test" });
    updateTaskStatus(task.id, "active");
    updateTaskStatus(task.id, "failed", "Error: something broke");
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.result).toBe("Error: something broke");
  });
});
