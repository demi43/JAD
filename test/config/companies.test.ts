import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompanyConfig } from "../../src/config/companies.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): string {
  tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-test-"));
  const filePath = join(tmpDir, "companies.json");
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

describe("loadCompanyConfig", () => {
  it("parses a valid config file", () => {
    const filePath = writeConfig([
      { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
      { name: "Another Co", ats: "lever", identifier: "anotherco" },
    ]);

    expect(loadCompanyConfig(filePath)).toEqual([
      { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
      { name: "Another Co", ats: "lever", identifier: "anotherco" },
    ]);
  });

  it("throws when the file doesn't exist", () => {
    expect(() => loadCompanyConfig("/nonexistent/companies.json")).toThrow(
      /could not read company config/i
    );
  });

  it("throws when an entry is missing a required field", () => {
    const filePath = writeConfig([{ name: "Example Co", ats: "greenhouse" }]);
    expect(() => loadCompanyConfig(filePath)).toThrow(/entry 0/i);
  });

  it("throws when an entry has an unsupported ats value", () => {
    const filePath = writeConfig([{ name: "Example Co", ats: "workday", identifier: "x" }]);
    expect(() => loadCompanyConfig(filePath)).toThrow(/unsupported ats/i);
  });
});
