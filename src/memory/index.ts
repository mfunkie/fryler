/**
 * SOUL.md and MEMORY.md reading/appending logic.
 */

import { join } from "path";

function getProjectRoot(): string {
  return join(import.meta.dir, "..", "..");
}

async function readSoul(): Promise<string> {
  const file = Bun.file(join(getProjectRoot(), "SOUL.md"));
  if (!(await file.exists())) return "";
  return file.text();
}

async function readMemory(): Promise<string> {
  const file = Bun.file(join(getProjectRoot(), "MEMORY.md"));
  if (!(await file.exists())) return "";
  return file.text();
}

async function appendMemory(entry: string): Promise<void> {
  const path = join(getProjectRoot(), "MEMORY.md");
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  const timestamp = new Date().toISOString();
  const appended = `${existing}\n### ${timestamp}\n${entry}`;
  await Bun.write(path, appended);
}

async function getIdentityContext(): Promise<string> {
  const soul = await readSoul();
  const memory = await readMemory();
  return `=== FRYLER IDENTITY (SOUL.md) ===\n${soul}\n\n=== FRYLER MEMORY (MEMORY.md) ===\n${memory}`;
}

export {
  getProjectRoot,
  readSoul,
  readMemory,
  appendMemory,
  getIdentityContext,
};
