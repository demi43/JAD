import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../src/db/client.js";
import {
  insertPosting,
  getAllPostings,
  getUnrankedPostings,
  saveRank,
  getRankedPostings,
} from "../../src/db/postings.js";
import type { Posting } from "../../src/types.js";

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

describe("ranking storage", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("getUnrankedPostings returns postings with no score yet", () => {
    insertPosting(db, makePosting());
    expect(getUnrankedPostings(db)).toEqual([makePosting()]);
  });

  it("saveRank stores the score and reason, removing it from unranked", () => {
    insertPosting(db, makePosting());
    saveRank(db, "greenhouse:1", 87, "Strong skills match.");
    expect(getUnrankedPostings(db)).toEqual([]);
  });

  it("getRankedPostings returns ranked postings sorted by score descending", () => {
    insertPosting(db, makePosting({ id: "a" }));
    insertPosting(db, makePosting({ id: "b" }));
    saveRank(db, "a", 40, "Partial match.");
    saveRank(db, "b", 90, "Strong match.");

    const ranked = getRankedPostings(db);
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
    expect(ranked[0]).toMatchObject({ rankScore: 90, rankReason: "Strong match." });
  });
});

describe("createDb migration", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds rank columns to a pre-existing postings table that lacks them", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-migrate-"));
    const dbPath = join(tmpDir, "legacy.sqlite3");

    // Simulate a Phase 1 database: postings table without rank columns.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE postings (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        ats TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        url TEXT NOT NULL,
        description_html TEXT NOT NULL,
        posted_at TEXT,
        discovered_at TEXT NOT NULL,
        dedupe_key TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        `INSERT INTO postings (id, company, ats, title, location, url, description_html, posted_at, discovered_at, dedupe_key)
         VALUES ('greenhouse:1', 'Example Co', 'greenhouse', 'Software Engineer', 'Remote', 'https://example.com/1', '<p>desc</p>', NULL, '2026-08-11T00:00:00.000Z', 'example co|software engineer|remote')`
      )
      .run();
    legacy.close();

    const db = createDb(dbPath);
    expect(getAllPostings(db)).toHaveLength(1);
    expect(getUnrankedPostings(db)).toHaveLength(1);
    saveRank(db, "greenhouse:1", 75, "Good match.");
    expect(getRankedPostings(db)).toHaveLength(1);
    db.close();
  });
});
