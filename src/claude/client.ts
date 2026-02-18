/**
 * Claude CLI wrapper — spawning, streaming, session management.
 * All AI work is done by shelling out to the `claude` CLI.
 */

import { homedir } from "node:os";
import { getIdentityContext } from "@/memory/index.ts";
import { getConfig } from "@/config/index.ts";
import { logger } from "@/logger/index.ts";

export interface ClaudeResponse {
  session_id: string;
  result: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

export interface AskOptions {
  sessionId?: string;
  continueSession?: boolean;
  maxTurns?: number;
  model?: string;
  systemPrompt?: string;
  injectIdentity?: boolean;
  noSessionPersistence?: boolean;
  cwd?: string;
}

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Returns a clean env object with CLAUDECODE and CLAUDE_CODE_ENTRY_POINT
 * removed so that the spawned claude process does not detect nesting.
 */
export function buildClaudeEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    CLAUDECODE: undefined,
    CLAUDE_CODE_ENTRY_POINT: undefined,
  };
}

/**
 * Build the args array for a claude CLI invocation.
 */
export async function buildArgs(
  prompt: string,
  outputFormat: "json" | "stream-json",
  options?: AskOptions,
): Promise<string[]> {
  const config = await getConfig();
  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    outputFormat,
    "--dangerously-skip-permissions",
  ];

  // Claude CLI requires --verbose when using --print with stream-json
  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }

  const injectIdentity = options?.injectIdentity ?? true;
  if (options?.systemPrompt) {
    const systemPrompt = injectIdentity
      ? `${await getIdentityContext()}\n\n${options.systemPrompt}`
      : options.systemPrompt;
    args.push("--system-prompt", systemPrompt);
  } else if (injectIdentity) {
    args.push("--system-prompt", await getIdentityContext());
  }

  if (options?.continueSession) {
    args.push("--continue");
  } else if (options?.sessionId) {
    args.push("--session-id", options.sessionId);
  }

  args.push("--max-turns", String(options?.maxTurns ?? config.claude_max_turns));
  args.push("--model", options?.model ?? config.claude_model);

  if (options?.noSessionPersistence) {
    args.push("--no-session-persistence");
  }

  return args;
}

/**
 * Parse the JSON output from claude CLI into a ClaudeResponse.
 * The output may be a single object or an array — find the object with type === "result".
 */
export function parseClaudeOutput(raw: string): ClaudeResponse {
  const parsed: unknown = JSON.parse(raw);

  let resultObj: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    const found = parsed.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "result",
    );
    if (!found) {
      throw new Error("No result object found in claude JSON array output");
    }
    resultObj = found as Record<string, unknown>;
  } else if (typeof parsed === "object" && parsed !== null) {
    resultObj = parsed as Record<string, unknown>;
  } else {
    throw new Error(`Unexpected claude output type: ${typeof parsed}`);
  }

  return {
    session_id: String(resultObj.session_id ?? ""),
    result: String(resultObj.result ?? ""),
    cost_usd: Number(resultObj.total_cost_usd ?? resultObj.cost_usd ?? 0),
    duration_ms: Number(resultObj.duration_ms ?? 0),
    num_turns: Number(resultObj.num_turns ?? 0),
    is_error: Boolean(resultObj.is_error ?? false),
  };
}

/**
 * One-shot query to the claude CLI. Returns parsed ClaudeResponse.
 */
export async function ask(prompt: string, options?: AskOptions): Promise<ClaudeResponse> {
  const args = await buildArgs(prompt, "json", options);

  logger.info("claude ask", { prompt: prompt.slice(0, 100), args_count: args.length });

  const proc = Bun.spawn(["claude", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnv(),
    cwd: options?.cwd ?? homedir(),
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.error("claude process exited with error", { exitCode, stderr });
    throw new Error(`claude exited with code ${exitCode}: ${stderr}`);
  }

  const response = parseClaudeOutput(stdout);

  logger.info("claude ask complete", {
    session_id: response.session_id,
    cost_usd: response.cost_usd,
    duration_ms: response.duration_ms,
    num_turns: response.num_turns,
    is_error: response.is_error,
  });

  return response;
}

/**
 * Streaming query to the claude CLI. Yields StreamEvent objects
 * parsed from NDJSON (one JSON object per line).
 */
export async function* askStreaming(
  prompt: string,
  options?: AskOptions,
): AsyncGenerator<StreamEvent> {
  const args = await buildArgs(prompt, "stream-json", options);

  logger.info("claude askStreaming", { prompt: prompt.slice(0, 100) });

  const proc = Bun.spawn(["claude", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnv(),
    cwd: options?.cwd ?? homedir(),
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          const event = JSON.parse(trimmed) as StreamEvent;
          yield event;
        } catch {
          logger.warn("Failed to parse stream-json line", { line: trimmed });
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim() !== "") {
      try {
        const event = JSON.parse(buffer.trim()) as StreamEvent;
        yield event;
      } catch {
        logger.warn("Failed to parse final stream-json line", { line: buffer.trim() });
      }
    }
  } finally {
    reader.releaseLock();
  }

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.error("claude streaming process exited with error", { exitCode, stderr });
    throw new Error(`claude exited with code ${exitCode}: ${stderr}`);
  }

  logger.info("claude askStreaming complete");
}

/**
 * Special wrapper for heartbeat task execution. Builds a system prompt
 * with identity context + task instructions, and uses --no-session-persistence.
 */
export async function askForTask(
  taskDescription: string,
  context?: string,
  cwd?: string,
): Promise<ClaudeResponse> {
  const identityContext = await getIdentityContext();
  const contextBlock = context ? `\n\n=== ADDITIONAL CONTEXT ===\n${context}` : "";
  const systemPrompt =
    `${identityContext}${contextBlock}\n\n` +
    `=== TASK INSTRUCTIONS ===\n` +
    `You are executing a task as part of a heartbeat cycle. ` +
    `Execute the following task thoroughly and return your results. ` +
    `Be concise but complete.`;

  logger.info("claude askForTask", { task: taskDescription.slice(0, 100), cwd });

  return ask(taskDescription, {
    systemPrompt,
    injectIdentity: false,
    noSessionPersistence: true,
    cwd,
  });
}
