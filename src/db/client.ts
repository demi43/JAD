import Database from "better-sqlite3";

export function createDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS postings (
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
    CREATE INDEX IF NOT EXISTS idx_postings_dedupe_key ON postings(dedupe_key);
  `);
  return db;
}
