import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import {
  _setOutboxDir,
  writeAction,
  processPendingActions,
  type OutboxAction,
} from "@/outbox/index.ts";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `fryler-outbox-test-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  _setOutboxDir(testDir);
});

afterEach(() => {
  _setOutboxDir(null);
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
});

describe("writeAction", () => {
  test("creates a .json file in the outbox directory", async () => {
    const action: OutboxAction = {
      type: "say",
      text: "Hello world",
      created_at: new Date().toISOString(),
    };
    await writeAction(action);

    const files = readdirSync(testDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);

    const content = JSON.parse(await Bun.file(join(testDir, files[0]!)).text());
    expect(content.type).toBe("say");
    expect(content.text).toBe("Hello world");
  });

  test("creates unique filenames for multiple writes", async () => {
    const action: OutboxAction = {
      type: "say",
      text: "test",
      created_at: new Date().toISOString(),
    };
    await writeAction(action);
    await writeAction(action);

    const files = readdirSync(testDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);
  });

  test("no .tmp files remain after write", async () => {
    await writeAction({
      type: "say",
      text: "test",
      created_at: new Date().toISOString(),
    });

    const tmpFiles = readdirSync(testDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("processPendingActions", () => {
  test("dispatches actions and deletes files", async () => {
    // Write files with controlled names to guarantee sort order
    writeFileSync(
      join(testDir, "0001-aaa.json"),
      JSON.stringify({ type: "say", text: "First", created_at: "2026-01-01T00:00:00Z" }),
    );
    writeFileSync(
      join(testDir, "0002-bbb.json"),
      JSON.stringify({ type: "say", text: "Second", created_at: "2026-01-01T00:00:01Z" }),
    );

    const dispatched: OutboxAction[] = [];
    await processPendingActions(async (action) => {
      dispatched.push(action);
    });

    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]!.text).toBe("First");
    expect(dispatched[1]!.text).toBe("Second");

    // Files should be deleted
    const remaining = readdirSync(testDir).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(0);
  });

  test("deletes files even when dispatcher throws", async () => {
    writeFileSync(
      join(testDir, "0001-aaa.json"),
      JSON.stringify({ type: "say", text: "Fail", created_at: "2026-01-01T00:00:00Z" }),
    );
    writeFileSync(
      join(testDir, "0002-bbb.json"),
      JSON.stringify({ type: "say", text: "Pass", created_at: "2026-01-01T00:00:01Z" }),
    );

    const dispatched: OutboxAction[] = [];
    await processPendingActions(async (action) => {
      if (action.text === "Fail") {
        throw new Error("dispatch error");
      }
      dispatched.push(action);
    });

    // Only the second one was collected
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.text).toBe("Pass");

    // Both files should be deleted
    const remaining = readdirSync(testDir).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(0);
  });

  test("handles empty outbox directory gracefully", async () => {
    const dispatched: OutboxAction[] = [];
    await processPendingActions(async (action) => {
      dispatched.push(action);
    });
    expect(dispatched).toHaveLength(0);
  });

  test("ignores non-JSON files", async () => {
    writeFileSync(join(testDir, "readme.txt"), "not an action");
    writeFileSync(join(testDir, "notes.md"), "also not an action");
    await writeAction({ type: "say", text: "Real action", created_at: "2026-01-01T00:00:00Z" });

    const dispatched: OutboxAction[] = [];
    await processPendingActions(async (action) => {
      dispatched.push(action);
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.text).toBe("Real action");

    // Non-JSON files should still exist
    expect(existsSync(join(testDir, "readme.txt"))).toBe(true);
    expect(existsSync(join(testDir, "notes.md"))).toBe(true);
  });
});
