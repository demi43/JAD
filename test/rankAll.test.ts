import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting, getRankedPostings } from "../src/db/postings.js";
import { rankAll } from "../src/rankAll.js";
import type { AiClient } from "../src/ai/client.js";
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

let db: Database.Database;
const filters = { includeKeywords: [], excludeKeywords: ["intern"] };

beforeEach(() => {
  db = createDb(":memory:");
});

describe("rankAll", () => {
  it("ranks postings that pass the filter and stores the result", async () => {
    insertPosting(db, makePosting());
    const client: AiClient = {
      complete: vi.fn().mockResolvedValue('{"score": 88, "reason": "Good fit."}'),
    };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 1, filteredOut: 0, ranked: 1, errors: 0 });
    expect(getRankedPostings(db)).toMatchObject([{ id: "greenhouse:1", rankScore: 88 }]);
  });

  it("skips postings that fail the title filter without calling the AI client", async () => {
    insertPosting(db, makePosting({ title: "Software Engineering Intern" }));
    const client: AiClient = { complete: vi.fn() };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 1, filteredOut: 1, ranked: 0, errors: 0 });
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("counts AI errors without stopping the run", async () => {
    insertPosting(db, makePosting({ id: "a" }));
    insertPosting(db, makePosting({ id: "b" }));
    const client: AiClient = {
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce('{"score": 60, "reason": "ok"}'),
    };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 2, filteredOut: 0, ranked: 1, errors: 1 });
  });
});
