import { mkdirSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getFrylerDir(): string {
  const dir = join(homedir(), ".fryler");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getPidPath(): string {
  return join(getFrylerDir(), "fryler.pid");
}

function writePid(): void {
  writeFileSync(getPidPath(), String(process.pid), "utf-8");
}

function readPid(): number | null {
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

function isRunning(pid?: number): boolean {
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

function removePid(): void {
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

function acquirePid(): boolean {
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

export { getFrylerDir, getPidPath, writePid, readPid, isRunning, removePid, acquirePid };
