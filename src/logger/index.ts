/**
 * Structured logging to ~/.fryler/logs/.
 */

import { mkdirSync, appendFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logDir = join(homedir(), ".fryler", "logs");
let logFile = join(logDir, "fryler.log");
let minLevel: LogLevel = "info";
let quiet = false;
let lastWriteDate: string | null = null;
let dirEnsured = false;

function setLevel(level: LogLevel): void {
  minLevel = level;
}

function getLevel(): LogLevel {
  return minLevel;
}

function setQuiet(value: boolean): void {
  quiet = value;
}

function ensureLogDir(): void {
  if (!dirEnsured) {
    mkdirSync(logDir, { recursive: true });
    dirEnsured = true;
  }
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function rotateIfNeeded(): void {
  const today = todayDateString();
  if (lastWriteDate !== null && lastWriteDate !== today) {
    if (existsSync(logFile)) {
      const rotatedName = join(logDir, `fryler-${lastWriteDate}.log`);
      renameSync(logFile, rotatedName);
    }
  }
  lastWriteDate = today;
}

function formatLine(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase();
  let line = `[${timestamp}] [${tag}] ${message}`;
  if (data !== undefined) {
    line += " " + JSON.stringify(data);
  }
  return line;
}

function writeLog(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) {
    return;
  }

  const line = formatLine(level, message, data);

  ensureLogDir();
  rotateIfNeeded();
  appendFileSync(logFile, line + "\n");

  if (!quiet) {
    switch (level) {
      case "debug":
      case "info":
        console.log(line);
        break;
      case "warn":
        console.warn(line);
        break;
      case "error":
        console.error(line);
        break;
    }
  }
}

function debug(message: string, data?: Record<string, unknown>): void {
  writeLog("debug", message, data);
}

function info(message: string, data?: Record<string, unknown>): void {
  writeLog("info", message, data);
}

function warn(message: string, data?: Record<string, unknown>): void {
  writeLog("warn", message, data);
}

function error(message: string, data?: Record<string, unknown>): void {
  writeLog("error", message, data);
}

/**
 * Reset internal state. Intended for testing only.
 */
function _reset(overrideDir?: string): void {
  if (overrideDir) {
    logDir = overrideDir;
    logFile = join(logDir, "fryler.log");
  } else {
    logDir = join(homedir(), ".fryler", "logs");
    logFile = join(logDir, "fryler.log");
  }
  minLevel = "info";
  quiet = false;
  lastWriteDate = null;
  dirEnsured = false;
}

/**
 * Override lastWriteDate for testing rotation. Intended for testing only.
 */
function _setLastWriteDate(date: string | null): void {
  lastWriteDate = date;
}

export const logger = {
  debug,
  info,
  warn,
  error,
  setLevel,
  getLevel,
  setQuiet,
  _reset,
  _setLastWriteDate,
};

export type { LogLevel };
