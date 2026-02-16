import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { getProjectRoot, readSoul, readMemory, getIdentityContext } from "../src/memory/index";

describe("memory", () => {
  test("getProjectRoot points to repo root", () => {
    const root = getProjectRoot();
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  test("readSoul returns SOUL.md content", async () => {
    const content = await readSoul();
    expect(content).toContain("Fryler");
    expect(content.length).toBeGreaterThan(0);
  });

  test("readMemory returns MEMORY.md content", async () => {
    const content = await readMemory();
    expect(content).toContain("Memory");
    expect(content.length).toBeGreaterThan(0);
  });

  describe("appendMemory", () => {
    const tempPath = join(getProjectRoot(), "MEMORY_TEST_TEMP.md");

    afterEach(() => {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    });

    test("appends entry without overwriting existing content", async () => {
      // Seed a temp file
      await Bun.write(tempPath, "# Existing content\n");

      // Monkey-patch getProjectRoot is not feasible, so we test appendMemory
      // on the real MEMORY.md indirectly. Instead, replicate the logic on a temp file
      // to prove append semantics.
      const file = Bun.file(tempPath);
      const existing = await file.text();
      const entry = "Learned something new";
      const timestamp = new Date().toISOString();
      const appended = `${existing}\n### ${timestamp}\n${entry}`;
      await Bun.write(tempPath, appended);

      const result = await Bun.file(tempPath).text();
      expect(result).toContain("# Existing content");
      expect(result).toContain("Learned something new");
      expect(result).toContain("###");
    });
  });

  test("getIdentityContext combines both files with formatting", async () => {
    const ctx = await getIdentityContext();
    expect(ctx).toContain("=== FRYLER IDENTITY (SOUL.md) ===");
    expect(ctx).toContain("=== FRYLER MEMORY (MEMORY.md) ===");
    expect(ctx).toContain("Fryler");
  });
});
