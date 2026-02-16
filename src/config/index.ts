/**
 * Configuration loading from ~/.fryler/config.toml.
 */

import { homedir } from "os";
import { join } from "path";

export interface FrylerConfig {
  heartbeat_interval_seconds: number;
  log_level: "debug" | "info" | "warn" | "error";
  container_image: string;
  container_name: string;
  claude_model: string;
  claude_max_turns: number;
}

export function getDefaultConfig(): FrylerConfig {
  return {
    heartbeat_interval_seconds: 60,
    log_level: "info",
    container_image: "fry-claude:latest",
    container_name: "fryler-runtime",
    claude_model: "sonnet",
    claude_max_turns: 25,
  };
}

export function parseTOML(content: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  let currentSection = "";

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }

    // Key-value pair
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip inline comments (only outside of quotes)
    if (value.startsWith('"')) {
      const closingQuote = value.indexOf('"', 1);
      if (closingQuote !== -1) {
        value = value.slice(1, closingQuote);
      }
    } else if (value.startsWith("'")) {
      const closingQuote = value.indexOf("'", 1);
      if (closingQuote !== -1) {
        value = value.slice(1, closingQuote);
      }
    } else {
      // Strip inline comment for unquoted values
      const commentIndex = value.indexOf("#");
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    const fullKey = currentSection ? `${currentSection}_${key}` : key;

    // Parse value type
    if (value === "true") {
      result[fullKey] = true;
    } else if (value === "false") {
      result[fullKey] = false;
    } else if (value !== "" && !isNaN(Number(value))) {
      result[fullKey] = Number(value);
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

export async function loadConfig(configPath?: string): Promise<FrylerConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = configPath ?? join(homedir(), ".fryler", "config.toml");

  let content: string;
  try {
    content = await Bun.file(resolvedPath).text();
  } catch {
    return defaults;
  }

  const parsed = parseTOML(content);

  return {
    ...defaults,
    ...parsed,
  } as FrylerConfig;
}

let cachedConfig: FrylerConfig | null = null;

export async function getConfig(): Promise<FrylerConfig> {
  if (cachedConfig === null) {
    cachedConfig = await loadConfig();
  }
  return cachedConfig;
}
