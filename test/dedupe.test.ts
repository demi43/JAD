import { describe, it, expect } from "vitest";
import { dedupeKey, dedupePostings } from "../src/dedupe.js";
import type { Posting } from "../src/types.js";

function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "greenhouse:1",
    company: "Example Co",
    ats: "greenhouse",
    title: "Software Engineer",
    location: "Remote",
    url: "https://example.com/1",
    descriptionHtml: "<p>desc</p>",
    postedAt: null,
    discoveredAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("dedupeKey", () => {
  it("normalizes case and whitespace", () => {
    const a = dedupeKey({ company: "Example Co", title: "Software Engineer", location: "Remote" });
    const b = dedupeKey({ company: "  example   co ", title: "software engineer", location: "REMOTE" });
    expect(a).toBe(b);
  });

  it("differs when company, title, or location differ", () => {
    const base = dedupeKey({ company: "Example Co", title: "Software Engineer", location: "Remote" });
    expect(dedupeKey({ company: "Other Co", title: "Software Engineer", location: "Remote" })).not.toBe(base);
    expect(dedupeKey({ company: "Example Co", title: "Data Scientist", location: "Remote" })).not.toBe(base);
    expect(dedupeKey({ company: "Example Co", title: "Software Engineer", location: "NYC" })).not.toBe(base);
  });
});

describe("dedupePostings", () => {
  it("drops postings whose key is already in existingKeys", () => {
    const existing = new Set([dedupeKey(makePosting())]);
    const result = dedupePostings([makePosting({ id: "greenhouse:2" })], existing);
    expect(result).toEqual([]);
  });

  it("drops duplicates within the input list, keeping the first occurrence", () => {
    const first = makePosting({ id: "greenhouse:1" });
    const duplicate = makePosting({ id: "lever:1" }); // same company/title/location, different id
    const result = dedupePostings([first, duplicate], new Set());
    expect(result).toEqual([first]);
  });

  it("keeps postings that are genuinely new", () => {
    const posting = makePosting();
    const result = dedupePostings([posting], new Set());
    expect(result).toEqual([posting]);
  });
});
