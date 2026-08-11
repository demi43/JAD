import type { Posting } from "./types.js";

/** Normalized signature used to detect the same posting from multiple sources. */
export function dedupeKey(posting: Pick<Posting, "company" | "title" | "location">): string {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${normalize(posting.company)}|${normalize(posting.title)}|${normalize(posting.location)}`;
}

/**
 * Filters out postings whose dedupe key is already in `existingKeys`, and drops
 * duplicates within `postings` itself, keeping the first occurrence.
 */
export function dedupePostings(postings: Posting[], existingKeys: Set<string>): Posting[] {
  const seen = new Set(existingKeys);
  const result: Posting[] = [];
  for (const posting of postings) {
    const key = dedupeKey(posting);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(posting);
  }
  return result;
}
