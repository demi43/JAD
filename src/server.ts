import express from "express";
import type { Express } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import { getAllPostings, getRankedPostings } from "./db/postings.js";
import { extractResumeText } from "./resume/extractText.js";
import { saveResume, getResume } from "./db/resume.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createServer(db: Database.Database): Express {
  const app = express();

  app.get("/api/postings", (_req, res) => {
    res.json(getAllPostings(db));
  });

  app.get("/postings", (_req, res) => {
    const postings = getAllPostings(db);
    const rows = postings
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.company)}</td>
          <td><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></td>
          <td>${escapeHtml(p.location)}</td>
          <td>${escapeHtml(p.discoveredAt)}</td>
        </tr>`
      )
      .join("\n");

    res.type("html").send(`<!doctype html>
<html>
  <head><title>Discovered Postings</title></head>
  <body>
    <h1>Discovered Postings</h1>
    <table border="1" cellpadding="6">
      <thead><tr><th>Company</th><th>Title</th><th>Location</th><th>Discovered</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`);
  });

  app.get("/queue", (_req, res) => {
    const ranked = getRankedPostings(db);
    const rows = ranked
      .map(
        (p) => `<tr>
          <td>${p.rankScore}</td>
          <td>${escapeHtml(p.company)}</td>
          <td><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></td>
          <td>${escapeHtml(p.location)}</td>
          <td>${escapeHtml(p.rankReason)}</td>
        </tr>`
      )
      .join("\n");

    res.type("html").send(`<!doctype html>
<html>
  <head><title>Ranked Queue</title></head>
  <body>
    <h1>Ranked Queue</h1>
    <table border="1" cellpadding="6">
      <thead><tr><th>Score</th><th>Company</th><th>Title</th><th>Location</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`);
  });

  app.post("/resume", upload.single("resume"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Send a multipart field named "resume".' });
      return;
    }
    try {
      const extractedText = await extractResumeText(req.file.buffer, req.file.mimetype);
      if (extractedText.length === 0) {
        res.status(422).json({ error: "Could not extract any text from the uploaded file." });
        return;
      }
      saveResume(db, {
        filename: req.file.originalname,
        extractedText,
        uploadedAt: new Date().toISOString(),
      });
      res.json({ filename: req.file.originalname, extractedLength: extractedText.length });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/resume", (_req, res) => {
    const resume = getResume(db);
    if (!resume) {
      res.status(404).json({ error: "No resume uploaded yet." });
      return;
    }
    res.json({
      filename: resume.filename,
      uploadedAt: resume.uploadedAt,
      extractedLength: resume.extractedText.length,
    });
  });

  return app;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
