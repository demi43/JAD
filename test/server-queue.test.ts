import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting, saveRank } from "../src/db/postings.js";
import { createServer } from "../src/server.js";
import type { Posting } from "../src/types.js";

let db: Database.Database;

const posting: Posting = {
  id: "greenhouse:1",
  company: "Example Co",
  ats: "greenhouse",
  title: "Software Engineer",
  location: "Remote",
  url: "https://example.com/1",
  descriptionHtml: "<p>desc</p>",
  postedAt: null,
  discoveredAt: "2026-08-11T00:00:00.000Z",
};

beforeEach(() => {
  db = createDb(":memory:");
});

describe("GET /queue", () => {
  it("lists ranked postings sorted by score with their reason", async () => {
    insertPosting(db, posting);
    insertPosting(db, { ...posting, id: "greenhouse:2", title: "Data Scientist" });
    saveRank(db, "greenhouse:1", 40, "Partial match.");
    saveRank(db, "greenhouse:2", 90, "Excellent match.");

    const app = createServer(db);
    const res = await request(app).get("/queue");

    expect(res.status).toBe(200);
    const dataScientistIndex = res.text.indexOf("Data Scientist");
    const softwareEngineerIndex = res.text.indexOf("Software Engineer");
    expect(dataScientistIndex).toBeGreaterThan(-1);
    expect(dataScientistIndex).toBeLessThan(softwareEngineerIndex);
    expect(res.text).toContain("Excellent match.");
  });

  it("excludes unranked postings", async () => {
    insertPosting(db, posting);
    const app = createServer(db);
    const res = await request(app).get("/queue");
    expect(res.text).not.toContain("Software Engineer");
  });
});
