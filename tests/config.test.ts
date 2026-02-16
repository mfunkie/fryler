import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getDefaultConfig, parseTOML, loadConfig } from "@/config/index.ts";

describe("getDefaultConfig", () => {
  test("returns expected defaults", () => {
    const config = getDefaultConfig();
    expect(config.heartbeat_interval_seconds).toBe(60);
    expect(config.log_level).toBe("info");
    expect(config.container_image).toBe("fryler:latest");
    expect(config.container_name).toBe("fryler-runtime");
    expect(config.data_dir).toContain(".fryler/data");
    expect(config.claude_model).toBe("sonnet");
    expect(config.claude_max_turns).toBe(25);
  });
});

describe("parseTOML", () => {
  test("parses quoted strings", () => {
    const result = parseTOML(`name = "hello world"`);
    expect(result.name).toBe("hello world");
  });

  test("parses single-quoted strings", () => {
    const result = parseTOML(`name = 'hello world'`);
    expect(result.name).toBe("hello world");
  });

  test("parses unquoted strings", () => {
    const result = parseTOML(`name = hello`);
    expect(result.name).toBe("hello");
  });

  test("parses integers", () => {
    const result = parseTOML(`count = 42`);
    expect(result.count).toBe(42);
  });

  test("parses floats", () => {
    const result = parseTOML(`rate = 3.14`);
    expect(result.rate).toBe(3.14);
  });

  test("parses boolean true", () => {
    const result = parseTOML(`enabled = true`);
    expect(result.enabled).toBe(true);
  });

  test("parses boolean false", () => {
    const result = parseTOML(`enabled = false`);
    expect(result.enabled).toBe(false);
  });

  test("skips comments", () => {
    const result = parseTOML(`# this is a comment\nname = "test"`);
    expect(Object.keys(result)).toEqual(["name"]);
    expect(result.name).toBe("test");
  });

  test("skips blank lines", () => {
    const result = parseTOML(`\n\nname = "test"\n\n`);
    expect(Object.keys(result)).toEqual(["name"]);
  });

  test("strips inline comments for unquoted values", () => {
    const result = parseTOML(`count = 42 # the answer`);
    expect(result.count).toBe(42);
  });

  test("flattens section headers", () => {
    const toml = `[daemon]
interval = 30

[claude]
model = "opus"
`;
    const result = parseTOML(toml);
    expect(result.daemon_interval).toBe(30);
    expect(result.claude_model).toBe("opus");
  });

  test("handles mixed content", () => {
    const toml = `# Global config
log_level = "debug"

[container]
image = "custom:v2"
name = "my-runtime"
enabled = true
replicas = 3
`;
    const result = parseTOML(toml);
    expect(result.log_level).toBe("debug");
    expect(result.container_image).toBe("custom:v2");
    expect(result.container_name).toBe("my-runtime");
    expect(result.container_enabled).toBe(true);
    expect(result.container_replicas).toBe(3);
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fryler-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns defaults when no config file exists", async () => {
    const configPath = join(tempDir, "nonexistent.toml");
    const config = await loadConfig(configPath);
    const defaults = getDefaultConfig();
    expect(config).toEqual(defaults);
  });

  test("merges file values with defaults (file values win)", async () => {
    const configPath = join(tempDir, "config.toml");
    await writeFile(configPath, `log_level = "debug"\nclaude_max_turns = 50\n`);

    const config = await loadConfig(configPath);
    expect(config.log_level).toBe("debug");
    expect(config.claude_max_turns).toBe(50);
    // Defaults should still be present for unset keys
    expect(config.heartbeat_interval_seconds).toBe(60);
    expect(config.container_image).toBe("fryler:latest");
    expect(config.container_name).toBe("fryler-runtime");
    expect(config.claude_model).toBe("sonnet");
  });
});
