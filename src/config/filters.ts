import { readFileSync } from "node:fs";

export interface FilterConfig {
  includeKeywords: string[];
  excludeKeywords: string[];
}

export function loadFilterConfig(path: string): FilterConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`Could not read filter config at ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Filter config at ${path} is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Filter config at ${path} must be a JSON object.`);
  }

  const { includeKeywords, excludeKeywords } = parsed as Record<string, unknown>;
  return {
    includeKeywords: validateKeywordList(includeKeywords, "includeKeywords", path),
    excludeKeywords: validateKeywordList(excludeKeywords, "excludeKeywords", path),
  };
}

function validateKeywordList(value: unknown, field: string, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`Filter config at ${path} has invalid "${field}": must be an array of strings.`);
  }
  return value;
}
