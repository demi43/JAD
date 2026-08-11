import type { FilterConfig } from "./config/filters.js";
import type { Posting } from "./types.js";

export function passesTitleFilter(
  posting: Pick<Posting, "title">,
  filters: FilterConfig
): boolean {
  const title = posting.title.toLowerCase();

  if (
    filters.includeKeywords.length > 0 &&
    !filters.includeKeywords.some((kw) => title.includes(kw.toLowerCase()))
  ) {
    return false;
  }

  if (filters.excludeKeywords.some((kw) => title.includes(kw.toLowerCase()))) {
    return false;
  }

  return true;
}
