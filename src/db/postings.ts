import type Database from "better-sqlite3";
import type { Posting } from "../types.js";
import { dedupeKey } from "../dedupe.js";

interface PostingRow {
  id: string;
  company: string;
  ats: Posting["ats"];
  title: string;
  location: string;
  url: string;
  description_html: string;
  posted_at: string | null;
  discovered_at: string;
}

export function insertPosting(db: Database.Database, posting: Posting): void {
  db.prepare(
    `INSERT OR IGNORE INTO postings
      (id, company, ats, title, location, url, description_html, posted_at, discovered_at, dedupe_key)
     VALUES (@id, @company, @ats, @title, @location, @url, @descriptionHtml, @postedAt, @discoveredAt, @dedupeKey)`
  ).run({
    id: posting.id,
    company: posting.company,
    ats: posting.ats,
    title: posting.title,
    location: posting.location,
    url: posting.url,
    descriptionHtml: posting.descriptionHtml,
    postedAt: posting.postedAt,
    discoveredAt: posting.discoveredAt,
    dedupeKey: dedupeKey(posting),
  });
}

export function getAllPostings(db: Database.Database): Posting[] {
  const rows = db
    .prepare(`SELECT * FROM postings ORDER BY discovered_at DESC`)
    .all() as PostingRow[];
  return rows.map(rowToPosting);
}

export function getAllDedupeKeys(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT DISTINCT dedupe_key AS key FROM postings`).all() as {
    key: string;
  }[];
  return new Set(rows.map((row) => row.key));
}

function rowToPosting(row: PostingRow): Posting {
  return {
    id: row.id,
    company: row.company,
    ats: row.ats,
    title: row.title,
    location: row.location,
    url: row.url,
    descriptionHtml: row.description_html,
    postedAt: row.posted_at,
    discoveredAt: row.discovered_at,
  };
}
