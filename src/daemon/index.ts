/**
 * Daemon lifecycle: start, run loop, shutdown.
 *
 * On start: acquire PID, init identity files, init DB, read identity, start heartbeat.
 * On stop: stop heartbeat, close DB, remove PID.
 *
 * Container lifecycle is managed externally by the host proxy (src/proxy).
 * The daemon runs directly inside the container (or on the host for dev).
 */

import { logger } from "../logger/index.ts";
import { acquirePid, removePid, isRunning, readPid } from "./pid.ts";
import { registerSignalHandlers } from "./signals.ts";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.ts";
import { getContainerStatus } from "../container/manager.ts";
import { getDb, closeDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { readSoul, readMemory, initIdentityFiles } from "../memory/index.ts";

let daemonRunning = false;

/**
 * Start the fryler daemon.
 */
export async function startDaemon(): Promise<void> {
  // Check for existing instance
  if (!acquirePid()) {
    const existingPid = readPid();
    console.error(
      `fryler daemon is already running (PID ${existingPid}). Use 'fryler stop' first.`,
    );
    process.exit(1);
  }

  const config = await getConfig();

  logger.info("Starting fryler daemon", { pid: process.pid });

  // Register signal handlers for graceful shutdown
  registerSignalHandlers(async () => {
    await shutdownDaemon();
  });

  try {
    // Initialize identity files (copies defaults on first container run)
    initIdentityFiles();

    // Initialize database
    getDb();
    logger.info("Database initialized");

    // Read identity files to verify they exist
    const soul = await readSoul();
    const memory = await readMemory();
    logger.info("Identity files loaded", {
      soulLength: soul.length,
      memoryLength: memory.length,
    });

    // Start heartbeat loop
    const intervalMs = config.heartbeat_interval_seconds * 1000;
    startHeartbeat(intervalMs);
    logger.info("Heartbeat started", {
      intervalSeconds: config.heartbeat_interval_seconds,
    });

    daemonRunning = true;
    logger.info("fryler daemon is running", { pid: process.pid });

    // Keep the process alive
    await new Promise(() => {
      // This promise never resolves — the daemon runs until signaled
    });
  } catch (err) {
    logger.error("Failed to start daemon", {
      error: err instanceof Error ? err.message : String(err),
    });
    await shutdownDaemon();
    process.exit(1);
  }
}

/**
 * Stop the fryler daemon (called from CLI).
 */
export async function stopDaemon(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    console.log("fryler daemon is not running.");
    return;
  }

  if (!isRunning(pid)) {
    console.log("fryler daemon PID file exists but process is not running. Cleaning up.");
    removePid();
    return;
  }

  console.log(`Stopping fryler daemon (PID ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
    // Wait a bit for graceful shutdown
    await Bun.sleep(2000);
    if (isRunning(pid)) {
      console.log("Daemon still running, sending SIGKILL...");
      process.kill(pid, "SIGKILL");
    }
    console.log("fryler daemon stopped.");
  } catch (err) {
    console.error("Failed to stop daemon:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Internal shutdown sequence.
 */
async function shutdownDaemon(): Promise<void> {
  if (!daemonRunning) return;
  daemonRunning = false;

  logger.info("Shutting down fryler daemon...");

  stopHeartbeat();
  logger.info("Heartbeat stopped");

  closeDb();
  logger.info("Database closed");

  removePid();
  logger.info("PID file removed");

  logger.info("fryler daemon shutdown complete");
}

/**
 * Get daemon status info.
 */
export async function getDaemonStatus(): Promise<{
  daemonRunning: boolean;
  pid: number | null;
  container: { running: boolean; name: string; uptime?: string };
}> {
  const config = await getConfig();
  const pid = readPid();
  const running = pid !== null && isRunning(pid);
  const container = await getContainerStatus(config.container_name);

  return {
    daemonRunning: running,
    pid: running ? pid : null,
    container,
  };
}

