import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting } from "../src/db/postings.js";
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
  insertPosting(db, posting);
});

describe("GET /api/postings", () => {
  it("returns stored postings as JSON", async () => {
    const app = createServer(db);
    const res = await request(app).get("/api/postings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([posting]);
  });
});

describe("GET /postings", () => {
  it("returns an HTML page listing the postings", async () => {
    const app = createServer(db);
    const res = await request(app).get("/postings");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Software Engineer");
    expect(res.text).toContain("Example Co");
  });

  it("escapes HTML in posting fields", async () => {
    db = createDb(":memory:");
    insertPosting(db, { ...posting, id: "greenhouse:2", title: "<script>alert(1)</script>" });
    const app = createServer(db);
    const res = await request(app).get("/postings");
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });
});
