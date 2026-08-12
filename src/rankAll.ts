import type Database from "better-sqlite3";
import type { AiClient } from "./ai/client.js";
import type { FilterConfig } from "./config/filters.js";
import { rankPosting } from "./ai/rank.js";
import { passesTitleFilter } from "./filter.js";
import { getUnrankedPostings, saveRank } from "./db/postings.js";

export interface RankAllResult {
  considered: number;
  filteredOut: number;
  ranked: number;
  errors: number;
  errorSamples: string[];
}

export async function rankAll(
  db: Database.Database,
  client: AiClient,
  resumeText: string,
  filters: FilterConfig
): Promise<RankAllResult> {
  const unranked = getUnrankedPostings(db);
  let filteredOut = 0;
  let ranked = 0;
  let errors = 0;
  const errorSamples: string[] = [];

  for (const posting of unranked) {
    if (!passesTitleFilter(posting, filters)) {
      filteredOut++;
      continue;
    }
    try {
      const result = await rankPosting(client, resumeText, posting);
      saveRank(db, posting.id, result.score, result.reason);
      ranked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Rank failed for posting ${posting.id}: ${message}`);
      if (errorSamples.length < 3) errorSamples.push(message);
      errors++;
    }
  }

  return { considered: unranked.length, filteredOut, ranked, errors, errorSamples };
}
