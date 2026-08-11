import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../../src/db/client.js";
import { insertPosting, getAllPostings, getAllDedupeKeys } from "../../src/db/postings.js";
import type { Posting } from "../../src/types.js";

let db: Database.Database;

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

beforeEach(() => {
  db = createDb(":memory:");
});

describe("postings storage", () => {
  it("round-trips a posting through insert and getAllPostings", () => {
    insertPosting(db, makePosting());
    expect(getAllPostings(db)).toEqual([makePosting()]);
  });

  it("ignores a second insert with the same id", () => {
    insertPosting(db, makePosting());
    insertPosting(db, makePosting({ title: "Different Title" }));
    expect(getAllPostings(db)).toHaveLength(1);
    expect(getAllPostings(db)[0].title).toBe("Software Engineer");
  });

  it("orders results by discoveredAt descending", () => {
    insertPosting(db, makePosting({ id: "a", discoveredAt: "2026-08-01T00:00:00.000Z" }));
    insertPosting(db, makePosting({ id: "b", discoveredAt: "2026-08-05T00:00:00.000Z" }));
    expect(getAllPostings(db).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("getAllDedupeKeys returns the dedupe key for every stored posting", () => {
    insertPosting(db, makePosting());
    const keys = getAllDedupeKeys(db);
    expect(keys.has("example co|software engineer|remote")).toBe(true);
  });
});
