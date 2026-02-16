/**
 * SOUL.md and MEMORY.md reading/appending logic.
 *
 * Inside a container (FRYLER_CONTAINER=1), identity files live in ~/.fryler/.
 * On the host (dev/test), they live in the project root.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";

function isInsideContainer(): boolean {
  return process.env.FRYLER_CONTAINER === "1";
}

export function getProjectRoot(): string {
  return join(import.meta.dir, "..", "..");
}

/**
 * Returns the directory where SOUL.md and MEMORY.md are resolved from.
 * In-container: ~/.fryler/ (persisted volume).
 * On host: project root (dev workflow).
 */
export function getIdentityDir(): string {
  if (isInsideContainer()) {
    return join(homedir(), ".fryler");
  }
  return getProjectRoot();
}

/**
 * Ensure identity files exist in ~/.fryler/ inside the container.
 * Copies baked-in defaults from /opt/fryler/ if not already present.
 * No-op on the host.
 */
export function initIdentityFiles(): void {
  if (!isInsideContainer()) return;

  const targetDir = join(homedir(), ".fryler");
  mkdirSync(targetDir, { recursive: true });

  const sourceDir = "/opt/fryler";
  for (const file of ["SOUL.md", "MEMORY.md"]) {
    const target = join(targetDir, file);
    if (!existsSync(target)) {
      const source = join(sourceDir, file);
      if (existsSync(source)) {
        copyFileSync(source, target);
      }
    }
  }
}

export async function readSoul(): Promise<string> {
  const file = Bun.file(join(getIdentityDir(), "SOUL.md"));
  if (!(await file.exists())) return "";
  return file.text();
}

export async function readMemory(): Promise<string> {
  const file = Bun.file(join(getIdentityDir(), "MEMORY.md"));
  if (!(await file.exists())) return "";
  return file.text();
}

export async function appendMemory(entry: string): Promise<void> {
  const path = join(getIdentityDir(), "MEMORY.md");
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  const timestamp = new Date().toISOString();
  const appended = `${existing}\n### ${timestamp}\n${entry}`;
  await Bun.write(path, appended);
}

export async function getIdentityContext(): Promise<string> {
  const soul = await readSoul();
  const memory = await readMemory();
  return `=== FRYLER IDENTITY (SOUL.md) ===\n${soul}\n\n=== FRYLER MEMORY (MEMORY.md) ===\n${memory}`;
}

