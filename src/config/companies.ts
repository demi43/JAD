import { readFileSync } from "node:fs";
import type { AtsPlatform, CompanySource } from "../types.js";

const SUPPORTED_ATS: AtsPlatform[] = ["greenhouse", "lever"];

export function loadCompanyConfig(path: string): CompanySource[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`Could not read company config at ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Company config at ${path} is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Company config at ${path} must be a JSON array of company entries.`);
  }

  return parsed.map((entry, index) => validateEntry(entry, index));
}

function validateEntry(entry: unknown, index: number): CompanySource {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`Company config entry ${index} must be an object.`);
  }
  const { name, ats, identifier } = entry as Record<string, unknown>;

  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(`Company config entry ${index} is missing a valid "name".`);
  }
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw new Error(`Company config entry ${index} is missing a valid "identifier".`);
  }
  if (typeof ats !== "string" || !SUPPORTED_ATS.includes(ats as AtsPlatform)) {
    throw new Error(
      `Company config entry ${index} has unsupported ats "${String(ats)}". Supported: ${SUPPORTED_ATS.join(", ")}.`
    );
  }

  return { name, ats: ats as AtsPlatform, identifier };
}
