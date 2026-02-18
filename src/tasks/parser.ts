/**
 * Extract FRYLER_TASK and FRYLER_MEMORY markers from Claude CLI responses.
 */

import { logger } from "@/logger/index.ts";

export interface ParsedTask {
  title: string;
  description: string;
  priority: number;
  scheduled_at: string | null;
  cwd: string | null;
}

export interface ParsedMemory {
  category: string;
  content: string;
}

export interface ParsedSay {
  text: string;
  voice: string | null;
}

export interface ParseResult {
  cleanText: string;
  tasks: ParsedTask[];
  memories: ParsedMemory[];
  says: ParsedSay[];
}

/**
 * Find all markers of a given type in the text.
 * Matches: <!-- FRYLER_TYPE: {json} -->
 */
export function extractMarkers(
  text: string,
  markerType: string,
): { json: string; fullMatch: string }[] {
  const pattern = new RegExp(`<!--\\s*FRYLER_${markerType}:\\s*(\\{.*?\\})\\s*-->`, "gs");
  const results: { json: string; fullMatch: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    results.push({
      json: match[1]!,
      fullMatch: match[0],
    });
  }

  return results;
}

/**
 * Validate and normalize a parsed task object.
 * Returns null if the task is invalid (missing required title).
 */
function validateTask(raw: unknown): ParsedTask | null {
  if (typeof raw !== "object" || raw === null) {
    logger.warn("Task marker JSON is not an object");
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.title !== "string" || obj.title.trim() === "") {
    logger.warn("Task marker missing required title field", { raw: obj });
    return null;
  }

  let priority = 3;
  if (typeof obj.priority === "number" && obj.priority >= 1 && obj.priority <= 5) {
    priority = obj.priority;
  }

  return {
    title: obj.title,
    description: typeof obj.description === "string" ? obj.description : "",
    priority,
    scheduled_at: typeof obj.scheduled_at === "string" ? obj.scheduled_at : null,
    cwd: typeof obj.cwd === "string" && obj.cwd.trim() !== "" ? obj.cwd : null,
  };
}

/**
 * Validate and normalize a parsed memory object.
 * Returns null if the memory is invalid (missing required fields).
 */
function validateMemory(raw: unknown): ParsedMemory | null {
  if (typeof raw !== "object" || raw === null) {
    logger.warn("Memory marker JSON is not an object");
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.category !== "string" || obj.category.trim() === "") {
    logger.warn("Memory marker missing required category field", { raw: obj });
    return null;
  }

  if (typeof obj.content !== "string" || obj.content.trim() === "") {
    logger.warn("Memory marker missing required content field", { raw: obj });
    return null;
  }

  return {
    category: obj.category,
    content: obj.content,
  };
}

/**
 * Validate and normalize a parsed say object.
 * Returns null if the say is invalid (missing required text).
 */
function validateSay(raw: unknown): ParsedSay | null {
  if (typeof raw !== "object" || raw === null) {
    logger.warn("Say marker JSON is not an object");
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.text !== "string" || obj.text.trim() === "") {
    logger.warn("Say marker missing required text field", { raw: obj });
    return null;
  }

  return {
    text: obj.text,
    voice: typeof obj.voice === "string" && obj.voice.trim() !== "" ? obj.voice : null,
  };
}

/**
 * Parse a raw Claude response, extracting task, memory, and say markers.
 * Returns clean text (all markers stripped) plus parsed tasks, memories, and says.
 */
export function parseClaudeResponse(rawText: string): ParseResult {
  const tasks: ParsedTask[] = [];
  const memories: ParsedMemory[] = [];
  const says: ParsedSay[] = [];
  let cleanText = rawText;

  const taskMarkers = extractMarkers(rawText, "TASK");
  for (const marker of taskMarkers) {
    try {
      const parsed = JSON.parse(marker.json);
      const task = validateTask(parsed);
      if (task) {
        tasks.push(task);
      }
    } catch {
      logger.warn("Failed to parse task marker JSON", {
        json: marker.json,
      });
    }
    cleanText = cleanText.replace(marker.fullMatch, "");
  }

  const memoryMarkers = extractMarkers(rawText, "MEMORY");
  for (const marker of memoryMarkers) {
    try {
      const parsed = JSON.parse(marker.json);
      const memory = validateMemory(parsed);
      if (memory) {
        memories.push(memory);
      }
    } catch {
      logger.warn("Failed to parse memory marker JSON", {
        json: marker.json,
      });
    }
    cleanText = cleanText.replace(marker.fullMatch, "");
  }

  const sayMarkers = extractMarkers(rawText, "SAY");
  for (const marker of sayMarkers) {
    try {
      const parsed = JSON.parse(marker.json);
      const say = validateSay(parsed);
      if (say) {
        says.push(say);
      }
    } catch {
      logger.warn("Failed to parse say marker JSON", {
        json: marker.json,
      });
    }
    cleanText = cleanText.replace(marker.fullMatch, "");
  }

  // Collapse any leftover blank lines from marker removal and trim trailing whitespace
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanText, tasks, memories, says };
}
