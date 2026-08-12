import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";

vi.mock("../src/resume/extractText.js", () => ({
  extractResumeText: vi.fn(),
}));

const { extractResumeText } = await import("../src/resume/extractText.js");
const { createServer } = await import("../src/server.js");

let db: Database.Database;

beforeEach(() => {
  db = createDb(":memory:");
  vi.mocked(extractResumeText).mockReset();
});

describe("GET /resume", () => {
  it("returns 404 when no resume has been uploaded", async () => {
    const app = createServer(db);
    const res = await request(app).get("/resume");
    expect(res.status).toBe(404);
  });
});

describe("POST /resume", () => {
  it("stores the extracted text and returns metadata", async () => {
    const extracted = "Experienced engineer with 5 years.";
    vi.mocked(extractResumeText).mockResolvedValue(extracted);
    const app = createServer(db);

    const uploadRes = await request(app)
      .post("/resume")
      .attach("resume", Buffer.from("fake pdf bytes"), {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body).toEqual({ filename: "resume.pdf", extractedLength: extracted.length });

    const statusRes = await request(app).get("/resume");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      filename: "resume.pdf",
      extractedLength: extracted.length,
    });
  });

  it("returns 400 when no file is attached", async () => {
    const app = createServer(db);
    const res = await request(app).post("/resume");
    expect(res.status).toBe(400);
  });

  it("returns 400 when extraction fails (e.g. unsupported file type)", async () => {
    vi.mocked(extractResumeText).mockRejectedValue(new Error("Unsupported resume file type"));
    const app = createServer(db);

    const res = await request(app)
      .post("/resume")
      .attach("resume", Buffer.from("plain text"), {
        filename: "resume.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported resume file type/);
  });
});
