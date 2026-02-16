import { describe, expect, test } from "bun:test";
import { buildClaudeEnv, buildArgs, parseClaudeOutput } from "@/claude/client.ts";

describe("buildClaudeEnv", () => {
  test("strips CLAUDECODE from the environment", () => {
    process.env.CLAUDECODE = "1";
    const env = buildClaudeEnv();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  test("strips CLAUDE_CODE_ENTRY_POINT from the environment", () => {
    process.env.CLAUDE_CODE_ENTRY_POINT = "cli";
    const env = buildClaudeEnv();
    expect(env.CLAUDE_CODE_ENTRY_POINT).toBeUndefined();
  });

  test("preserves other environment variables", () => {
    process.env.MY_TEST_VAR = "hello";
    const env = buildClaudeEnv();
    expect(env.MY_TEST_VAR).toBe("hello");
    delete process.env.MY_TEST_VAR;
  });
});

describe("buildArgs", () => {
  test("builds basic args with prompt and json format", async () => {
    const args = await buildArgs("hello world", "json");
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("hello world");
    expect(args[2]).toBe("--output-format");
    expect(args[3]).toBe("json");
  });

  test("includes --output-format stream-json when requested", async () => {
    const args = await buildArgs("test", "stream-json");
    expect(args).toContain("stream-json");
  });

  test("includes --system-prompt by default (identity injection)", async () => {
    const args = await buildArgs("test", "json");
    expect(args).toContain("--system-prompt");
  });

  test("uses custom system prompt when provided", async () => {
    const args = await buildArgs("test", "json", {
      systemPrompt: "You are a helpful bot",
    });
    const sysIdx = args.indexOf("--system-prompt");
    expect(sysIdx).toBeGreaterThan(-1);
    expect(args[sysIdx + 1]).toContain("You are a helpful bot");
  });

  test("prepends identity context to custom system prompt by default", async () => {
    const args = await buildArgs("test", "json", {
      systemPrompt: "Custom instructions",
    });
    const sysIdx = args.indexOf("--system-prompt");
    const prompt = args[sysIdx + 1]!;
    expect(prompt).toContain("FRYLER IDENTITY");
    expect(prompt).toContain("Custom instructions");
  });

  test("skips identity injection when injectIdentity is false", async () => {
    const args = await buildArgs("test", "json", {
      systemPrompt: "Bare prompt",
      injectIdentity: false,
    });
    const sysIdx = args.indexOf("--system-prompt");
    expect(args[sysIdx + 1]).toBe("Bare prompt");
  });

  test("skips system prompt entirely when injectIdentity is false and no systemPrompt", async () => {
    const args = await buildArgs("test", "json", {
      injectIdentity: false,
    });
    expect(args).not.toContain("--system-prompt");
  });

  test("includes --session-id when provided", async () => {
    const args = await buildArgs("test", "json", {
      sessionId: "abc-123",
    });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("abc-123");
  });

  test("includes --max-turns with default from config", async () => {
    const args = await buildArgs("test", "json");
    const idx = args.indexOf("--max-turns");
    expect(idx).toBeGreaterThan(-1);
    // Default config max_turns is 25
    expect(args[idx + 1]).toBe("25");
  });

  test("overrides max-turns when provided", async () => {
    const args = await buildArgs("test", "json", { maxTurns: 5 });
    const idx = args.indexOf("--max-turns");
    expect(args[idx + 1]).toBe("5");
  });

  test("includes --model with default from config", async () => {
    const args = await buildArgs("test", "json");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    // Default config model is "sonnet"
    expect(args[idx + 1]).toBe("sonnet");
  });

  test("overrides model when provided", async () => {
    const args = await buildArgs("test", "json", { model: "opus" });
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("opus");
  });

  test("includes --no-session-persistence when requested", async () => {
    const args = await buildArgs("test", "json", {
      noSessionPersistence: true,
    });
    expect(args).toContain("--no-session-persistence");
  });

  test("omits --no-session-persistence by default", async () => {
    const args = await buildArgs("test", "json");
    expect(args).not.toContain("--no-session-persistence");
  });
});

describe("parseClaudeOutput", () => {
  test("parses a single result object", () => {
    const raw = JSON.stringify({
      type: "result",
      session_id: "sess-1",
      result: "Hello!",
      total_cost_usd: 0.05,
      duration_ms: 1200,
      num_turns: 1,
      is_error: false,
    });
    const resp = parseClaudeOutput(raw);
    expect(resp.session_id).toBe("sess-1");
    expect(resp.result).toBe("Hello!");
    expect(resp.cost_usd).toBe(0.05);
    expect(resp.duration_ms).toBe(1200);
    expect(resp.num_turns).toBe(1);
    expect(resp.is_error).toBe(false);
  });

  test("finds the result object in an array", () => {
    const raw = JSON.stringify([
      { type: "assistant", message: "thinking..." },
      {
        type: "result",
        session_id: "sess-2",
        result: "Done",
        total_cost_usd: 0.1,
        duration_ms: 3000,
        num_turns: 3,
        is_error: false,
      },
    ]);
    const resp = parseClaudeOutput(raw);
    expect(resp.session_id).toBe("sess-2");
    expect(resp.result).toBe("Done");
    expect(resp.cost_usd).toBe(0.1);
    expect(resp.num_turns).toBe(3);
  });

  test("throws when array has no result object", () => {
    const raw = JSON.stringify([{ type: "assistant", message: "hi" }]);
    expect(() => parseClaudeOutput(raw)).toThrow("No result object found");
  });

  test("throws on non-object/non-array output", () => {
    expect(() => parseClaudeOutput('"just a string"')).toThrow("Unexpected claude output type");
  });

  test("handles missing fields with defaults", () => {
    const raw = JSON.stringify({ type: "result" });
    const resp = parseClaudeOutput(raw);
    expect(resp.session_id).toBe("");
    expect(resp.result).toBe("");
    expect(resp.cost_usd).toBe(0);
    expect(resp.duration_ms).toBe(0);
    expect(resp.num_turns).toBe(0);
    expect(resp.is_error).toBe(false);
  });

  test("maps total_cost_usd to cost_usd", () => {
    const raw = JSON.stringify({
      type: "result",
      total_cost_usd: 0.42,
    });
    const resp = parseClaudeOutput(raw);
    expect(resp.cost_usd).toBe(0.42);
  });

  test("is_error true is preserved", () => {
    const raw = JSON.stringify({
      type: "result",
      is_error: true,
      result: "something broke",
    });
    const resp = parseClaudeOutput(raw);
    expect(resp.is_error).toBe(true);
    expect(resp.result).toBe("something broke");
  });
});
