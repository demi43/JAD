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

  for (const posting of unranked) {
    if (!passesTitleFilter(posting, filters)) {
      filteredOut++;
      continue;
    }
    try {
      const result = await rankPosting(client, resumeText, posting);
      saveRank(db, posting.id, result.score, result.reason);
      ranked++;
    } catch {
      errors++;
    }
  }

  return { considered: unranked.length, filteredOut, ranked, errors };
}
