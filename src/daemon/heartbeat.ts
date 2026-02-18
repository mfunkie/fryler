/**
 * Heartbeat loop — checks for pending tasks and executes due work.
 */

import { getDueTasks, updateTaskStatus, createTask } from "@/db/tasks.ts";
import { createMemory } from "@/db/memories.ts";
import { appendMemory } from "@/memory/index.ts";
import { askForTask } from "@/claude/client.ts";
import { parseClaudeResponse } from "@/tasks/parser.ts";
import { writeSayAction } from "@/outbox/index.ts";
import { logger } from "@/logger/index.ts";

let intervalId: ReturnType<typeof setInterval> | null = null;
let busy = false;

export function startHeartbeat(intervalMs: number): void {
  if (intervalId !== null) {
    logger.warn("Heartbeat already running, ignoring startHeartbeat call");
    return;
  }

  logger.info("Starting heartbeat", { intervalMs });
  intervalId = setInterval(() => {
    heartbeatTick().catch((err) => {
      logger.error("Heartbeat tick crashed unexpectedly", {
        error: String(err),
      });
    });
  }, intervalMs);
}

export function stopHeartbeat(): void {
  logger.info("Stopping heartbeat");
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export async function heartbeatTick(): Promise<void> {
  if (busy) {
    logger.warn("Heartbeat tick skipped — previous tick still running");
    return;
  }
  busy = true;
  const tickStart = performance.now();

  const mem = process.memoryUsage();
  logger.info("Heartbeat tick starting", {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
  });

  try {
    const dueTasks = getDueTasks();
    logger.info(`Found ${dueTasks.length} pending task(s)`);

    for (const task of dueTasks) {
      try {
        logger.info(`Processing task #${task.id}: ${task.title}`);
        updateTaskStatus(task.id, "active");

        const response = await askForTask(task.description || task.title, task.title, task.cwd ?? undefined);

        logger.info(`Task #${task.id} claude response received`, {
          session_id: response.session_id,
          cost_usd: response.cost_usd,
          duration_ms: response.duration_ms,
          is_error: response.is_error,
        });

        const parsed = parseClaudeResponse(response.result);

        // Store any memories found in the response
        for (const mem of parsed.memories) {
          logger.info(`Storing memory from task #${task.id}`, {
            category: mem.category,
          });
          createMemory(mem.category, mem.content, `task-${task.id}`);
          await appendMemory(mem.content);
        }

        // Create any new tasks found in the response
        for (const newTask of parsed.tasks) {
          logger.info(`Creating sub-task from task #${task.id}`, {
            title: newTask.title,
          });
          createTask({
            title: newTask.title,
            description: newTask.description,
            priority: newTask.priority,
            scheduled_at: newTask.scheduled_at,
            cwd: newTask.cwd,
          });
        }

        // Queue any say actions found in the response
        for (const say of parsed.says) {
          await writeSayAction(say.text, say.voice);
          logger.info(`Queued say action from task #${task.id}`, {
            text: say.text.slice(0, 50),
          });
        }

        updateTaskStatus(task.id, "completed", parsed.cleanText);
        logger.info(`Task #${task.id} completed`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Task #${task.id} failed: ${message}`);
        updateTaskStatus(task.id, "failed", message);
      }
    }

    logger.info("Heartbeat tick complete", {
      duration_ms: Math.round(performance.now() - tickStart),
    });
  } finally {
    busy = false;
  }
}

export async function triggerHeartbeat(): Promise<void> {
  await heartbeatTick();
}

export function isHeartbeatRunning(): boolean {
  return intervalId !== null;
}
