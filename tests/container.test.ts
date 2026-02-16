import { describe, test, expect } from "bun:test";
import { isContainerAvailable, imageExists } from "../src/container/manager.ts";

describe("container manager", () => {
  test("isContainerAvailable returns true when CLI exists", async () => {
    const available = await isContainerAvailable();
    expect(available).toBe(true);
  });

  test("imageExists finds fry-claude:latest", async () => {
    const exists = await imageExists("fry-claude:latest");
    expect(exists).toBe(true);
  });

  test("imageExists returns false for nonexistent image", async () => {
    const exists = await imageExists("nonexistent-image:v999");
    expect(exists).toBe(false);
  });

  // Integration tests that actually start/stop containers are skipped by default
  // to avoid side effects. Run them manually with: bun test tests/container.test.ts
  // test("start and stop container lifecycle", async () => { ... });
});
