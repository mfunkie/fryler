import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "fs";

// We need to override the PID path for testing, so we mock the module
// by importing the actual functions and using a temp dir approach.
// Since the module uses homedir(), we'll test via a temp-dir strategy:
// write/read directly to a temp PID file and test the logic functions.

import {
  writePid,
  readPid,
  isRunning,
  removePid,
  acquirePid,
  getPidPath,
  getFrylerDir,
} from "../src/daemon/pid";

describe("pid", () => {
  let originalPidPath: string;
  let pidFileExistedBefore: boolean;

  beforeEach(() => {
    // Save state — if a real PID file exists, note it
    originalPidPath = getPidPath();
    pidFileExistedBefore = existsSync(originalPidPath);

    // Clean up any PID file from a previous test run
    if (existsSync(originalPidPath) && !pidFileExistedBefore) {
      rmSync(originalPidPath);
    }
  });

  afterEach(() => {
    // Clean up PID file after tests if we created it
    const pidPath = getPidPath();
    if (existsSync(pidPath) && !pidFileExistedBefore) {
      rmSync(pidPath);
    }
  });

  test("writePid and readPid round-trip", () => {
    writePid();
    const pid = readPid();
    expect(pid).toBe(process.pid);
    removePid();
  });

  test("readPid returns null when no PID file exists", () => {
    removePid();
    const pid = readPid();
    expect(pid).toBeNull();
  });

  test("isRunning returns true for current process PID", () => {
    expect(isRunning(process.pid)).toBe(true);
  });

  test("isRunning returns false for a non-existent PID", () => {
    expect(isRunning(99999999)).toBe(false);
  });

  test("isRunning returns false when no PID file and no argument", () => {
    removePid();
    expect(isRunning()).toBe(false);
  });

  test("removePid cleans up the file", () => {
    writePid();
    expect(existsSync(getPidPath())).toBe(true);
    removePid();
    expect(existsSync(getPidPath())).toBe(false);
  });

  test("removePid is safe to call when no file exists", () => {
    removePid();
    expect(() => removePid()).not.toThrow();
  });

  test("acquirePid succeeds when no other instance running", () => {
    removePid();
    const acquired = acquirePid();
    expect(acquired).toBe(true);
    const pid = readPid();
    expect(pid).toBe(process.pid);
    removePid();
  });

  test("acquirePid cleans up stale PID file", () => {
    // Write a PID that is not running
    const { writeFileSync } = require("fs");
    writeFileSync(getPidPath(), "99999999", "utf-8");
    const acquired = acquirePid();
    expect(acquired).toBe(true);
    removePid();
  });

  test("acquirePid succeeds when stale PID matches own PID (container restart)", () => {
    // Simulates container restart where PID file persists with PID 1
    // and the new process is also PID 1
    const { writeFileSync } = require("fs");
    writeFileSync(getPidPath(), String(process.pid), "utf-8");
    const acquired = acquirePid();
    expect(acquired).toBe(true);
    removePid();
  });

  test("getFrylerDir returns a path ending with .fryler", () => {
    const dir = getFrylerDir();
    expect(dir.endsWith(".fryler")).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});
