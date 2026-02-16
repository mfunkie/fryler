/**
 * Interactive terminal REPL for fryler sessions.
 * Streams responses from Claude CLI and tracks sessions in the DB.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { askStreaming, type AskOptions } from "@/claude/client.ts";
import { createSession, getSession, updateSession } from "@/db/sessions.ts";
import { parseClaudeResponse } from "@/tasks/parser.ts";
import { createTask } from "@/db/tasks.ts";
import { createMemory } from "@/db/memories.ts";
import { appendMemory } from "@/memory/index.ts";
import { logger } from "@/logger/index.ts";

interface ReplOptions {
  sessionId?: string;
  autoResume?: boolean;
}

async function startRepl(options?: ReplOptions): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  let sessionId: string | null = options?.sessionId ?? null;
  let hasExchanged = false; // true after first successful message in this session
  let messageCount = 0;

  console.log("fryler interactive mode. Type /help for commands, /quit to exit.");
  if (sessionId) {
    console.log(`Resuming session: ${sessionId}`);
  }
  console.log();

  while (true) {
    let input: string;
    try {
      input = (await rl.question("fryler> ")).trim();
    } catch {
      // EOF or stream closed
      break;
    }

    if (!input) continue;

    // Slash commands
    if (input.startsWith("/")) {
      const handled = handleSlashCommand(
        input,
        () => {
          sessionId = null;
          hasExchanged = false;
          messageCount = 0;
        },
        sessionId,
      );
      if (handled === "quit") break;
      if (handled === "handled") continue;
      // "unknown" falls through to print error
      console.log(`Unknown command: ${input.split(/\s+/)[0]}. Type /help for commands.\n`);
      continue;
    }

    // Send to Claude with streaming
    try {
      const askOpts: AskOptions = {};
      if (hasExchanged || options?.autoResume) {
        // Use --continue to resume without session lock conflicts
        askOpts.continueSession = true;
      } else if (sessionId) {
        // Explicit session ID (e.g., fryler resume <id>)
        askOpts.sessionId = sessionId;
      }

      let fullResult = "";
      let resultSessionId = "";
      let lastTextLength = 0;

      process.stdout.write("\n");

      for await (const event of askStreaming(input, askOpts)) {
        // Stream text from assistant message events
        if (event.type === "assistant" && event.message) {
          const msg = event.message as Record<string, unknown>;
          if (Array.isArray(msg.content)) {
            let currentText = "";
            for (const block of msg.content as Array<Record<string, unknown>>) {
              if (block.type === "text" && typeof block.text === "string") {
                currentText += block.text;
              }
            }
            // New assistant turn (after tool use) — text resets, so reset our counter
            if (currentText.length < lastTextLength) {
              lastTextLength = 0;
            }
            // Print only new characters since last update
            if (currentText.length > lastTextLength) {
              process.stdout.write(currentText.slice(lastTextLength));
              lastTextLength = currentText.length;
            }
          }
        }

        // Capture final result
        if (event.type === "result") {
          fullResult = String(event.result ?? "");
          resultSessionId = String(event.session_id ?? "");
        }
      }

      // If streaming didn't display text, show the full result
      if (lastTextLength === 0 && fullResult) {
        const parsed = parseClaudeResponse(fullResult);
        process.stdout.write(parsed.cleanText);
      }

      process.stdout.write("\n\n");

      // Track session in DB
      if (resultSessionId) {
        if (!sessionId) {
          sessionId = resultSessionId;
          // Only create if not already tracked (e.g. auto-resumed via --continue)
          if (!getSession(sessionId)) {
            createSession(sessionId, `[chat] ${input.slice(0, 80)}`);
          }
        }
        hasExchanged = true;
        messageCount++;
        updateSession(sessionId, messageCount);
      }

      // Silently process markers from the full result
      if (fullResult) {
        await processMarkers(fullResult);
      }
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : String(err));
      console.log();
    }
  }

  console.log("Goodbye.");
  rl.close();
}

/**
 * Handle REPL slash commands. Returns "quit", "handled", or "unknown".
 */
function handleSlashCommand(
  input: string,
  resetSession: () => void,
  sessionId: string | null,
): "quit" | "handled" | "unknown" {
  const cmd = input.split(/\s+/)[0]!.toLowerCase();

  if (cmd === "/quit" || cmd === "/exit") {
    return "quit";
  }

  if (cmd === "/new") {
    resetSession();
    console.log("Started new session.\n");
    return "handled";
  }

  if (cmd === "/session") {
    console.log(sessionId ? `Session: ${sessionId}` : "No active session");
    console.log();
    return "handled";
  }

  if (cmd === "/help") {
    console.log("Commands:");
    console.log("  /new       Start a new conversation");
    console.log("  /session   Show current session ID");
    console.log("  /quit      Exit the REPL");
    console.log("  /help      Show this help");
    console.log();
    return "handled";
  }

  return "unknown";
}

/**
 * Extract tasks and memories from a Claude response and persist them.
 */
async function processMarkers(text: string): Promise<void> {
  const parsed = parseClaudeResponse(text);

  for (const task of parsed.tasks) {
    createTask(task);
    logger.info("REPL: created task from response", { title: task.title });
  }

  for (const mem of parsed.memories) {
    createMemory(mem.category, mem.content, "repl");
    await appendMemory(mem.content);
    logger.info("REPL: stored memory from response", {
      category: mem.category,
    });
  }
}

export { startRepl };
export type { ReplOptions };
