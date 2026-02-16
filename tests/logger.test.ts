import { describe, test, expect, beforeEach, afterAll, spyOn } from "bun:test";
import { logger } from "@/logger/index.ts";
import { rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_LOG_DIR = join(tmpdir(), `fryler-logger-test-${process.pid}`);
const TEST_LOG_FILE = join(TEST_LOG_DIR, "fryler.log");

beforeEach(() => {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true });
  }
  logger._reset(TEST_LOG_DIR);
});

afterAll(() => {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true });
  }
  logger._reset();
});

describe("logger", () => {
  test("creates log directory on first write", () => {
    expect(existsSync(TEST_LOG_DIR)).toBe(false);
    logger.info("hello");
    expect(existsSync(TEST_LOG_DIR)).toBe(true);
  });

  test("creates log file on first write", () => {
    expect(existsSync(TEST_LOG_FILE)).toBe(false);
    logger.info("first message");
    expect(existsSync(TEST_LOG_FILE)).toBe(true);
  });

  test("log line format matches [ISO_TIMESTAMP] [LEVEL] message", () => {
    logger.info("test message");
    const content = readFileSync(TEST_LOG_FILE, "utf-8").trim();
    const match = content.match(
      /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[INFO\] test message$/
    );
    expect(match).not.toBeNull();
  });

  test("log line includes JSON data when provided", () => {
    logger.info("with data", { key: "value", num: 42 });
    const content = readFileSync(TEST_LOG_FILE, "utf-8").trim();
    const match = content.match(
      /^\[.+\] \[INFO\] with data (.+)$/
    );
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!);
    expect(parsed).toEqual({ key: "value", num: 42 });
  });

  test("writes correct level tags", () => {
    logger.setLevel("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const lines = readFileSync(TEST_LOG_FILE, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("[DEBUG]");
    expect(lines[1]).toContain("[INFO]");
    expect(lines[2]).toContain("[WARN]");
    expect(lines[3]).toContain("[ERROR]");
  });

  test("debug messages are ignored when level is info", () => {
    logger.setLevel("info");
    logger.debug("should be ignored");
    logger.info("should be written");
    const content = readFileSync(TEST_LOG_FILE, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[INFO]");
    expect(content).not.toContain("should be ignored");
  });

  test("warn and error pass through when level is info", () => {
    logger.setLevel("info");
    logger.warn("warning");
    logger.error("failure");
    const lines = readFileSync(TEST_LOG_FILE, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[WARN]");
    expect(lines[1]).toContain("[ERROR]");
  });

  test("setLevel and getLevel work correctly", () => {
    expect(logger.getLevel()).toBe("info");
    logger.setLevel("error");
    expect(logger.getLevel()).toBe("error");
    logger.info("ignored");
    logger.warn("also ignored");
    logger.error("not ignored");
    const lines = readFileSync(TEST_LOG_FILE, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[ERROR]");
  });

  test("daily rotation renames old log when date changes", () => {
    logger.info("day one message");
    expect(existsSync(TEST_LOG_FILE)).toBe(true);

    // Simulate that yesterday was the last write date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    logger._setLastWriteDate(yesterdayStr);

    logger.info("day two message");

    const rotatedFile = join(TEST_LOG_DIR, `fryler-${yesterdayStr}.log`);
    expect(existsSync(rotatedFile)).toBe(true);

    const rotatedContent = readFileSync(rotatedFile, "utf-8");
    expect(rotatedContent).toContain("day one message");

    const currentContent = readFileSync(TEST_LOG_FILE, "utf-8");
    expect(currentContent).toContain("day two message");
    expect(currentContent).not.toContain("day one message");
  });

  test("console.log is called for info level", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    logger.info("console test");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("[INFO] console test");
    spy.mockRestore();
  });

  test("console.error is called for error level", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    logger.error("error test");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("[ERROR] error test");
    spy.mockRestore();
  });
});
