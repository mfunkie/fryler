import { mkdirSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function getFrylerDir(): string {
  const dir = join(homedir(), ".fryler");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getPidPath(): string {
  return join(getFrylerDir(), "fryler.pid");
}

export function writePid(): void {
  writeFileSync(getPidPath(), String(process.pid), "utf-8");
}

export function readPid(): number | null {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) {
    return null;
  }
  const content = readFileSync(pidPath, "utf-8").trim();
  const pid = parseInt(content, 10);
  if (Number.isNaN(pid)) {
    return null;
  }
  return pid;
}

export function isRunning(pid?: number): boolean {
  const targetPid = pid ?? readPid();
  if (targetPid === null || targetPid === undefined) {
    return false;
  }
  try {
    process.kill(targetPid, 0);
    return true;
  } catch {
    return false;
  }
}

export function removePid(): void {
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

export function acquirePid(): boolean {
  const existingPid = readPid();
  if (existingPid !== null) {
    if (isRunning(existingPid)) {
      return false;
    }
    removePid();
  }
  writePid();
  return true;
}

