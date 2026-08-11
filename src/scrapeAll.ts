import type Database from "better-sqlite3";
import type { CompanySource, Posting } from "./types.js";
import { fetchGreenhousePostings } from "./scrapers/greenhouse.js";
import { fetchLeverPostings } from "./scrapers/lever.js";
import { dedupePostings } from "./dedupe.js";
import { getAllDedupeKeys, insertPosting } from "./db/postings.js";

export interface ScrapeResult {
  company: string;
  postingsFound: number;
  postingsInserted: number;
  error?: string;
}

export async function scrapeAll(
  db: Database.Database,
  companies: CompanySource[]
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  for (const source of companies) {
    try {
      const postings = await fetchForSource(source);
      const existingKeys = getAllDedupeKeys(db);
      const fresh = dedupePostings(postings, existingKeys);
      for (const posting of fresh) {
        insertPosting(db, posting);
      }
      results.push({
        company: source.name,
        postingsFound: postings.length,
        postingsInserted: fresh.length,
      });
    } catch (err) {
      results.push({
        company: source.name,
        postingsFound: 0,
        postingsInserted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

function fetchForSource(source: CompanySource): Promise<Posting[]> {
  switch (source.ats) {
    case "greenhouse":
      return fetchGreenhousePostings(source);
    case "lever":
      return fetchLeverPostings(source);
  }
}
