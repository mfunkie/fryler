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
  logger.info("Heartbeat tick starting");

  const dueTasks = getDueTasks();
  logger.info(`Found ${dueTasks.length} pending task(s)`);

  for (const task of dueTasks) {
    try {
      logger.info(`Processing task #${task.id}: ${task.title}`);
      updateTaskStatus(task.id, "active");

      const response = await askForTask(task.description || task.title, task.title);

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

  logger.info("Heartbeat tick complete");
}

export async function triggerHeartbeat(): Promise<void> {
  await heartbeatTick();
}

export function isHeartbeatRunning(): boolean {
  return intervalId !== null;
}
