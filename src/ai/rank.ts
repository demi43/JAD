import type { AiClient } from "./client.js";
import type { Posting } from "../types.js";

export interface RankResult {
  score: number;
  reason: string;
}

const SYSTEM_PROMPT =
  "You score how well a candidate's resume matches a job posting. " +
  'Respond with strict JSON only, no other text: {"score": <integer 0-100>, "reason": "<one sentence>"}.';

export async function rankPosting(
  client: AiClient,
  resumeText: string,
  posting: Pick<Posting, "title" | "company" | "descriptionHtml">
): Promise<RankResult> {
  const userPrompt = `Resume:\n${resumeText}\n\nJob posting - ${posting.title} at ${posting.company}:\n${stripHtml(posting.descriptionHtml)}`;
  const content = await client.complete(SYSTEM_PROMPT, userPrompt);
  return parseRankResponse(content);
}

function parseRankResponse(content: string): RankResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`AI ranking response was not valid JSON: ${content}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).score !== "number" ||
    typeof (parsed as Record<string, unknown>).reason !== "string"
  ) {
    throw new Error(`AI ranking response missing score/reason: ${content}`);
  }

  const record = parsed as { score: number; reason: string };
  const score = Math.max(0, Math.min(100, Math.round(record.score)));
  return { score, reason: record.reason };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
