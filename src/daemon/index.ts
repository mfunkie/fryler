/**
 * Daemon lifecycle: start, run loop, shutdown.
 *
 * On start: acquire PID, start container, init DB, read identity files, start heartbeat.
 * On stop: stop heartbeat, destroy container, remove PID.
 */

import { logger } from "../logger/index.ts";
import { acquirePid, removePid, isRunning, readPid } from "./pid.ts";
import { registerSignalHandlers } from "./signals.ts";
import { startHeartbeat, stopHeartbeat, triggerHeartbeat } from "./heartbeat.ts";
import { startContainer, destroyContainer, getContainerStatus } from "../container/manager.ts";
import { getDb, closeDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { readSoul, readMemory } from "../memory/index.ts";
import type { FrylerConfig } from "../config/index.ts";

let daemonRunning = false;

/**
 * Start the fryler daemon.
 */
async function startDaemon(): Promise<void> {
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
    await shutdownDaemon(config);
  });

  try {
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

    // Start container
    await startContainer({
      image: config.container_image,
      name: config.container_name,
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
    await shutdownDaemon(config);
    process.exit(1);
  }
}

/**
 * Stop the fryler daemon (called from CLI).
 */
async function stopDaemon(): Promise<void> {
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
async function shutdownDaemon(config: FrylerConfig): Promise<void> {
  if (!daemonRunning) return;
  daemonRunning = false;

  logger.info("Shutting down fryler daemon...");

  stopHeartbeat();
  logger.info("Heartbeat stopped");

  try {
    await destroyContainer(config.container_name);
    logger.info("Container destroyed");
  } catch (err) {
    logger.warn("Failed to destroy container", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  closeDb();
  logger.info("Database closed");

  removePid();
  logger.info("PID file removed");

  logger.info("fryler daemon shutdown complete");
}

/**
 * Get daemon status info.
 */
async function getDaemonStatus(): Promise<{
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

export { startDaemon, stopDaemon, getDaemonStatus, triggerHeartbeat };
