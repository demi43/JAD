import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFilterConfig } from "../../src/config/filters.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): string {
  tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-filters-test-"));
  const filePath = join(tmpDir, "filters.json");
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

describe("loadFilterConfig", () => {
  it("parses a valid config file", () => {
    const filePath = writeConfig({ includeKeywords: ["engineer"], excludeKeywords: ["intern"] });
    expect(loadFilterConfig(filePath)).toEqual({
      includeKeywords: ["engineer"],
      excludeKeywords: ["intern"],
    });
  });

  it("defaults missing keyword lists to empty arrays", () => {
    const filePath = writeConfig({});
    expect(loadFilterConfig(filePath)).toEqual({ includeKeywords: [], excludeKeywords: [] });
  });

  it("throws when the file doesn't exist", () => {
    expect(() => loadFilterConfig("/nonexistent/filters.json")).toThrow(
      /could not read filter config/i
    );
  });

  it("throws when a keyword list contains a non-string", () => {
    const filePath = writeConfig({ includeKeywords: ["engineer", 5] });
    expect(() => loadFilterConfig(filePath)).toThrow(/includeKeywords/);
  });
});
