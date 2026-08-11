import { describe, it, expect } from "vitest";
import { passesTitleFilter } from "../src/filter.js";

describe("passesTitleFilter", () => {
  it("passes everything when both keyword lists are empty", () => {
    expect(
      passesTitleFilter({ title: "Anything" }, { includeKeywords: [], excludeKeywords: [] })
    ).toBe(true);
  });

  it("requires at least one include keyword to match, case-insensitively", () => {
    const filters = { includeKeywords: ["engineer"], excludeKeywords: [] };
    expect(passesTitleFilter({ title: "Software Engineer" }, filters)).toBe(true);
    expect(passesTitleFilter({ title: "SOFTWARE ENGINEER II" }, filters)).toBe(true);
    expect(passesTitleFilter({ title: "Product Manager" }, filters)).toBe(false);
  });

  it("rejects titles matching an exclude keyword, case-insensitively", () => {
    const filters = { includeKeywords: [], excludeKeywords: ["intern"] };
    expect(passesTitleFilter({ title: "Software Engineering Intern" }, filters)).toBe(false);
    expect(passesTitleFilter({ title: "Software Engineer" }, filters)).toBe(true);
  });

  it("exclude takes precedence over include", () => {
    const filters = { includeKeywords: ["engineer"], excludeKeywords: ["intern"] };
    expect(passesTitleFilter({ title: "Software Engineering Intern" }, filters)).toBe(false);
  });
});
