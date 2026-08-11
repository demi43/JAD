import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { getAllPostings } from "./db/postings.js";

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

  return app;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
