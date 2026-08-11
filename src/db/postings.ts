import type Database from "better-sqlite3";
import type { Posting, RankedPosting } from "../types.js";
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
  rank_score: number | null;
  rank_reason: string | null;
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

export function getUnrankedPostings(db: Database.Database): Posting[] {
  const rows = db
    .prepare(`SELECT * FROM postings WHERE rank_score IS NULL ORDER BY discovered_at DESC`)
    .all() as PostingRow[];
  return rows.map(rowToPosting);
}

export function saveRank(
  db: Database.Database,
  postingId: string,
  score: number,
  reason: string
): void {
  db.prepare(`UPDATE postings SET rank_score = ?, rank_reason = ? WHERE id = ?`).run(
    score,
    reason,
    postingId
  );
}

export function getRankedPostings(db: Database.Database): RankedPosting[] {
  const rows = db
    .prepare(`SELECT * FROM postings WHERE rank_score IS NOT NULL ORDER BY rank_score DESC`)
    .all() as PostingRow[];
  return rows.map((row) => ({
    ...rowToPosting(row),
    rankScore: row.rank_score as number,
    rankReason: row.rank_reason as string,
  }));
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
