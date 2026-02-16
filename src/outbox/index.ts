/**
 * Outbox pattern for container-to-host communication.
 *
 * The container writes JSON action files to a shared volume directory.
 * The host watches for new files and dispatches them.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync, renameSync, watch, type FSWatcher } from "node:fs";
import { logger } from "@/logger/index.ts";

export interface OutboxAction {
  type: "say";
  text: string;
  voice?: string;
  created_at: string;
}

let outboxDirOverride: string | null = null;

/**
 * Override the outbox directory (for testing).
 */
export function _setOutboxDir(dir: string | null): void {
  outboxDirOverride = dir;
}

/**
 * Get the outbox directory path.
 * Container: ~/.fryler/outbox/
 * Host: ~/.fryler/data/outbox/
 */
export function getOutboxDir(): string {
  if (outboxDirOverride) return outboxDirOverride;
  const isContainer = process.env.FRYLER_CONTAINER === "1";
  if (isContainer) {
    return join(homedir(), ".fryler", "outbox");
  }
  return join(homedir(), ".fryler", "data", "outbox");
}

/**
 * Write an action to the outbox directory atomically.
 * Uses .tmp extension during write, then renames to .json.
 */
export async function writeAction(action: OutboxAction): Promise<void> {
  const dir = getOutboxDir();
  mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const filename = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = join(dir, `${filename}.tmp`);
  const finalPath = join(dir, `${filename}.json`);

  await Bun.write(tmpPath, JSON.stringify(action));
  renameSync(tmpPath, finalPath);
}

/**
 * Convenience wrapper to write a "say" action to the outbox.
 */
export async function writeSayAction(text: string, voice?: string | null): Promise<void> {
  const action: OutboxAction = {
    type: "say",
    text,
    created_at: new Date().toISOString(),
  };
  if (voice) {
    action.voice = voice;
  }
  await writeAction(action);
}

/**
 * Read all pending .json action files, dispatch them, and delete them.
 * Files are processed in alphabetical order (timestamp-sorted by filename).
 */
export async function processPendingActions(
  dispatcher: (action: OutboxAction) => Promise<void>,
): Promise<void> {
  const dir = getOutboxDir();
  mkdirSync(dir, { recursive: true });

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = await Bun.file(filePath).text();
      const action = JSON.parse(content) as OutboxAction;
      await dispatcher(action);
    } catch (err) {
      logger.warn("Failed to dispatch outbox action", {
        file,
        error: String(err),
      });
    }
    // Always delete the file — no infinite retry
    try {
      unlinkSync(filePath);
    } catch {
      // File may have been deleted by another process
    }
  }
}

let watcher: FSWatcher | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start watching the outbox directory for new action files.
 * Uses a 50ms settle delay to batch rapid writes.
 */
export function startWatcher(dispatcher: (action: OutboxAction) => Promise<void>): void {
  const dir = getOutboxDir();
  mkdirSync(dir, { recursive: true });

  stopWatcher();

  watcher = watch(dir, (_event, filename) => {
    if (!filename || !filename.endsWith(".json")) return;

    // Settle delay: wait 50ms after the last event before processing
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      processPendingActions(dispatcher).catch((err) => {
        logger.warn("Outbox watcher dispatch failed", {
          error: String(err),
        });
      });
    }, 50);
  });
}

/**
 * Stop watching the outbox directory.
 */
export function stopWatcher(): void {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/**
 * Host-side action dispatcher. Executes actions locally.
 */
export async function dispatchAction(action: OutboxAction): Promise<void> {
  switch (action.type) {
    case "say": {
      const args = ["say"];
      if (action.voice) {
        args.push("-v", action.voice);
      }
      args.push(action.text);
      const proc = Bun.spawn(args, {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      break;
    }
    default:
      logger.warn("Unknown outbox action type", {
        type: (action as unknown as Record<string, unknown>).type,
      });
  }
}
