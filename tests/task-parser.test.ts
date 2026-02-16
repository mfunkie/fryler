import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { parseClaudeResponse, extractMarkers } from "@/tasks/parser.ts";
import { logger } from "@/logger/index.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";

const TEST_LOG_DIR = join(tmpdir(), `fryler-parser-test-${process.pid}`);

beforeEach(() => {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true });
  }
  logger._reset(TEST_LOG_DIR);
  logger.setLevel("error");
});

describe("extractMarkers", () => {
  test("extracts a single TASK marker", () => {
    const text = `Hello\n<!-- FRYLER_TASK: {"title": "Do thing"} -->`;
    const results = extractMarkers(text, "TASK");
    expect(results).toHaveLength(1);
    expect(results[0]!.json).toBe('{"title": "Do thing"}');
  });

  test("extracts multiple TASK markers", () => {
    const text = [
      "Intro text",
      '<!-- FRYLER_TASK: {"title": "First"} -->',
      "Middle text",
      '<!-- FRYLER_TASK: {"title": "Second"} -->',
    ].join("\n");
    const results = extractMarkers(text, "TASK");
    expect(results).toHaveLength(2);
    expect(results[0]!.json).toBe('{"title": "First"}');
    expect(results[1]!.json).toBe('{"title": "Second"}');
  });

  test("extracts MEMORY markers separately from TASK markers", () => {
    const text = [
      '<!-- FRYLER_TASK: {"title": "A task"} -->',
      '<!-- FRYLER_MEMORY: {"category": "pref", "content": "Likes fish"} -->',
    ].join("\n");
    const tasks = extractMarkers(text, "TASK");
    const memories = extractMarkers(text, "MEMORY");
    expect(tasks).toHaveLength(1);
    expect(memories).toHaveLength(1);
  });

  test("handles whitespace variations in marker syntax", () => {
    const variations = [
      '<!--FRYLER_TASK: {"title": "No leading space"} -->',
      '<!--  FRYLER_TASK:  {"title": "Extra spaces"}  -->',
      '<!-- FRYLER_TASK:{"title": "No space after colon"} -->',
    ];
    for (const text of variations) {
      const results = extractMarkers(text, "TASK");
      expect(results).toHaveLength(1);
    }
  });

  test("returns empty array when no markers found", () => {
    const results = extractMarkers("Just plain text", "TASK");
    expect(results).toHaveLength(0);
  });
});

describe("parseClaudeResponse", () => {
  test("parses a single task marker", () => {
    const raw = [
      "Here is my response.",
      "",
      '<!-- FRYLER_TASK: {"title": "Research insulin", "description": "Look into brands", "priority": 2, "scheduled_at": null} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe("Research insulin");
    expect(result.tasks[0]!.description).toBe("Look into brands");
    expect(result.tasks[0]!.priority).toBe(2);
    expect(result.tasks[0]!.scheduled_at).toBeNull();
  });

  test("parses multiple task markers", () => {
    const raw = [
      "Response text.",
      '<!-- FRYLER_TASK: {"title": "Task A", "priority": 1} -->',
      '<!-- FRYLER_TASK: {"title": "Task B", "priority": 5} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.title).toBe("Task A");
    expect(result.tasks[0]!.priority).toBe(1);
    expect(result.tasks[1]!.title).toBe("Task B");
    expect(result.tasks[1]!.priority).toBe(5);
  });

  test("parses memory markers", () => {
    const raw = [
      "Some response.",
      '<!-- FRYLER_MEMORY: {"category": "preference", "content": "User prefers dry food"} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.category).toBe("preference");
    expect(result.memories[0]!.content).toBe("User prefers dry food");
  });

  test("parses mixed task and memory markers", () => {
    const raw = [
      "Intro.",
      '<!-- FRYLER_TASK: {"title": "Buy food"} -->',
      "Middle.",
      '<!-- FRYLER_MEMORY: {"category": "fact", "content": "Cat is named Fry"} -->',
      '<!-- FRYLER_TASK: {"title": "Schedule vet"} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(2);
    expect(result.memories).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe("Buy food");
    expect(result.tasks[1]!.title).toBe("Schedule vet");
    expect(result.memories[0]!.content).toBe("Cat is named Fry");
  });

  test("strips all markers from clean text", () => {
    const raw = [
      "Start of response.",
      '<!-- FRYLER_TASK: {"title": "Hidden task"} -->',
      "End of response.",
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.cleanText).not.toContain("FRYLER_TASK");
    expect(result.cleanText).not.toContain("<!--");
    expect(result.cleanText).not.toContain("-->");
    expect(result.cleanText).toContain("Start of response.");
    expect(result.cleanText).toContain("End of response.");
  });

  test("strips memory markers from clean text", () => {
    const raw = `Text here.\n<!-- FRYLER_MEMORY: {"category": "x", "content": "y"} -->\nMore text.`;
    const result = parseClaudeResponse(raw);
    expect(result.cleanText).not.toContain("FRYLER_MEMORY");
    expect(result.cleanText).toContain("Text here.");
    expect(result.cleanText).toContain("More text.");
  });

  test("handles malformed JSON gracefully", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = [
      "Response.",
      "<!-- FRYLER_TASK: {not valid json} -->",
      '<!-- FRYLER_TASK: {"title": "Valid task"} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe("Valid task");
    expect(result.cleanText).not.toContain("FRYLER_TASK");
    warnSpy.mockRestore();
  });

  test("handles malformed memory JSON gracefully", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = 'Text.\n<!-- FRYLER_MEMORY: {not valid json} -->';
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(0);
    expect(result.cleanText).toBe("Text.");
    warnSpy.mockRestore();
  });

  test("skips task with missing title", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_TASK: {"description": "No title here"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("skips task with empty title", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_TASK: {"title": ""} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("skips task with whitespace-only title", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_TASK: {"title": "   "} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("defaults priority to 3 when missing", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "No priority"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(3);
  });

  test("defaults priority to 3 when out of range (too low)", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "Low", "priority": 0} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(3);
  });

  test("defaults priority to 3 when out of range (too high)", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "High", "priority": 10} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(3);
  });

  test("defaults priority to 3 when not a number", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "Bad", "priority": "high"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(3);
  });

  test("defaults scheduled_at to null when missing", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "No schedule"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.scheduled_at).toBeNull();
  });

  test("defaults description to empty string when missing", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "No desc"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.description).toBe("");
  });

  test("skips memory with missing category", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_MEMORY: {"content": "Has content but no category"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("skips memory with missing content", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_MEMORY: {"category": "fact"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("skips memory with empty category", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_MEMORY: {"category": "", "content": "Something"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("skips memory with empty content", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_MEMORY: {"category": "fact", "content": ""} -->';
    const result = parseClaudeResponse(raw);
    expect(result.memories).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("returns original text with empty arrays when no markers present", () => {
    const raw = "Just a normal response with no special markers.";
    const result = parseClaudeResponse(raw);
    expect(result.cleanText).toBe(raw);
    expect(result.tasks).toHaveLength(0);
    expect(result.memories).toHaveLength(0);
  });

  test("handles marker at the start of text", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "First thing"} -->\nThen some text.';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(1);
    expect(result.cleanText).toBe("Then some text.");
  });

  test("handles marker in the middle of text", () => {
    const raw = 'Before.\n<!-- FRYLER_TASK: {"title": "Middle"} -->\nAfter.';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(1);
    expect(result.cleanText).toContain("Before.");
    expect(result.cleanText).toContain("After.");
  });

  test("handles marker at the end of text", () => {
    const raw = 'Some text.\n<!-- FRYLER_TASK: {"title": "Last"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(1);
    expect(result.cleanText).toBe("Some text.");
  });

  test("handles empty input", () => {
    const result = parseClaudeResponse("");
    expect(result.cleanText).toBe("");
    expect(result.tasks).toHaveLength(0);
    expect(result.memories).toHaveLength(0);
  });

  test("preserves scheduled_at string value", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "Scheduled", "scheduled_at": "2026-03-01T10:00:00Z"} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.scheduled_at).toBe("2026-03-01T10:00:00Z");
  });

  test("collapses excessive blank lines after marker removal", () => {
    const raw = "Line one.\n\n\n<!-- FRYLER_TASK: {\"title\": \"X\"} -->\n\n\nLine two.";
    const result = parseClaudeResponse(raw);
    expect(result.cleanText).not.toMatch(/\n{3,}/);
    expect(result.cleanText).toContain("Line one.");
    expect(result.cleanText).toContain("Line two.");
  });

  test("does not crash on non-object JSON in task marker", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = '<!-- FRYLER_TASK: "just a string" -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("does not crash on array JSON in task marker", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const raw = "<!-- FRYLER_TASK: [1, 2, 3] -->";
    // The regex expects {...} so this should not match at all
    const result = parseClaudeResponse(raw);
    expect(result.tasks).toHaveLength(0);
    warnSpy.mockRestore();
  });

  test("accepts priority at boundary values (1 and 5)", () => {
    const raw = [
      '<!-- FRYLER_TASK: {"title": "Urgent", "priority": 1} -->',
      '<!-- FRYLER_TASK: {"title": "Low", "priority": 5} -->',
    ].join("\n");
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(1);
    expect(result.tasks[1]!.priority).toBe(5);
  });

  test("handles negative priority", () => {
    const raw = '<!-- FRYLER_TASK: {"title": "Neg", "priority": -1} -->';
    const result = parseClaudeResponse(raw);
    expect(result.tasks[0]!.priority).toBe(3);
  });
});
