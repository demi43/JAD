import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../../src/db/client.js";
import { saveResume, getResume } from "../../src/db/resume.js";

let db: Database.Database;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("resume storage", () => {
  it("returns null when no resume has been uploaded", () => {
    expect(getResume(db)).toBeNull();
  });

  it("round-trips a saved resume, including file bytes and mime type", () => {
    const fileBytes = Buffer.from("fake pdf bytes");
    saveResume(db, {
      filename: "resume.pdf",
      extractedText: "Experienced engineer.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
      mimeType: "application/pdf",
      fileBytes,
    });
    const resume = getResume(db);
    expect(resume).toEqual({
      filename: "resume.pdf",
      extractedText: "Experienced engineer.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
      mimeType: "application/pdf",
      fileBytes,
    });
    expect(Buffer.isBuffer(resume?.fileBytes)).toBe(true);
  });

  it("replaces the previous resume on a second save", () => {
    saveResume(db, {
      filename: "old.pdf",
      extractedText: "Old.",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      mimeType: "application/pdf",
      fileBytes: Buffer.from("old bytes"),
    });
    saveResume(db, {
      filename: "new.pdf",
      extractedText: "New.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
      mimeType: "application/pdf",
      fileBytes: Buffer.from("new bytes"),
    });
    const resume = getResume(db);
    expect(resume?.filename).toBe("new.pdf");
    expect(resume?.extractedText).toBe("New.");
    expect(resume?.fileBytes.toString()).toBe("new bytes");
  });
});
