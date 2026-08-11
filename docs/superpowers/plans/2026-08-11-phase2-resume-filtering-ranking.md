# Phase 2 — Resume, Filtering & Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload their resume, extract its text, and use AI (via a self-hosted LiteLLM proxy, so any provider/model can be swapped in for testing) to score and rank Phase 1's discovered postings against it, filtered first by title keywords, surfaced in a queue sorted by relevance.

**Architecture:** Extends the Phase 1 backend, not a new service. A resume upload endpoint extracts plain text deterministically (no AI) and stores it as the single active resume. A title-keyword filter runs first (cheap, no AI cost), then a `POST /rank` route calls a small AI client — the only module that talks to LiteLLM — to score each surviving posting against the resume text, storing `{score, reason}` back onto the posting. A `GET /queue` view lists ranked postings sorted by score, same plain-HTML approach as Phase 1's `/postings`.

**Tech Stack:** Same as Phase 1 (TypeScript, Express, better-sqlite3, Vitest + supertest), plus: `openai` SDK (used as a generic OpenAI-compatible client against LiteLLM, not against OpenAI directly), `multer` (multipart file upload), `pdf-parse` and `mammoth` (deterministic PDF/DOCX text extraction).

## Global Constraints

- Personal, single-user tool — no auth, no multi-tenancy.
- TypeScript end-to-end, per the design spec.
- All AI calls go through `src/ai/client.ts` (the LiteLLM wrapper) — no other module talks to an AI provider directly, so swapping models/providers is a proxy-config change, not an app-code change.
- Exactly one active resume at a time; a new upload replaces the previous one, no versioning.
- Resume parsing in this phase is deterministic text extraction only (`pdf-parse` / `mammoth`) — no AI call at upload time. Structuring into work history/skills/education is Phase 3's concern.
- Rule filtering in this phase is title-only include/exclude keyword matching — no location or seniority filter yet.
- Schema changes must be additive migrations (add columns if missing), not destructive — Phase 1's existing local database (with real scraped postings) must keep working after this phase's changes.

## Scope note

This plan implements the "Phase 2 addendum" in `docs/superpowers/specs/2026-08-11-job-application-assistant-design.md`. It builds on Phase 1's `src/types.ts`, `src/db/*`, and `src/server.ts` — read those files' current state before starting if picking this up fresh.

---

### Task 1: Ranking storage — schema migration and queries

**Files:**
- Modify: `src/db/client.ts`
- Modify: `src/db/postings.ts`
- Modify: `src/types.ts`
- Test: `test/db/ranking.test.ts`

**Interfaces:**
- Consumes: `Posting`, existing `createDb`/`insertPosting` (Phase 1).
- Produces: `RankedPosting extends Posting { rankScore: number; rankReason: string }`; `getUnrankedPostings(db): Posting[]`; `saveRank(db, postingId: string, score: number, reason: string): void`; `getRankedPostings(db): RankedPosting[]`. `createDb` gains an additive migration that adds `rank_score`/`rank_reason` columns if missing, safe to run against a pre-existing Phase 1 database.

- [ ] **Step 1: Write the failing test**

`test/db/ranking.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../src/db/client.js";
import {
  insertPosting,
  getAllPostings,
  getUnrankedPostings,
  saveRank,
  getRankedPostings,
} from "../../src/db/postings.js";
import type { Posting } from "../../src/types.js";

function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "greenhouse:1",
    company: "Example Co",
    ats: "greenhouse",
    title: "Software Engineer",
    location: "Remote",
    url: "https://example.com/1",
    descriptionHtml: "<p>desc</p>",
    postedAt: null,
    discoveredAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("ranking storage", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("getUnrankedPostings returns postings with no score yet", () => {
    insertPosting(db, makePosting());
    expect(getUnrankedPostings(db)).toEqual([makePosting()]);
  });

  it("saveRank stores the score and reason, removing it from unranked", () => {
    insertPosting(db, makePosting());
    saveRank(db, "greenhouse:1", 87, "Strong skills match.");
    expect(getUnrankedPostings(db)).toEqual([]);
  });

  it("getRankedPostings returns ranked postings sorted by score descending", () => {
    insertPosting(db, makePosting({ id: "a" }));
    insertPosting(db, makePosting({ id: "b" }));
    saveRank(db, "a", 40, "Partial match.");
    saveRank(db, "b", 90, "Strong match.");

    const ranked = getRankedPostings(db);
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
    expect(ranked[0]).toMatchObject({ rankScore: 90, rankReason: "Strong match." });
  });
});

describe("createDb migration", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds rank columns to a pre-existing postings table that lacks them", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-migrate-"));
    const dbPath = join(tmpDir, "legacy.sqlite3");

    // Simulate a Phase 1 database: postings table without rank columns.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE postings (
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
    `);
    legacy
      .prepare(
        `INSERT INTO postings (id, company, ats, title, location, url, description_html, posted_at, discovered_at, dedupe_key)
         VALUES ('greenhouse:1', 'Example Co', 'greenhouse', 'Software Engineer', 'Remote', 'https://example.com/1', '<p>desc</p>', NULL, '2026-08-11T00:00:00.000Z', 'example co|software engineer|remote')`
      )
      .run();
    legacy.close();

    const db = createDb(dbPath);
    expect(getAllPostings(db)).toHaveLength(1);
    expect(getUnrankedPostings(db)).toHaveLength(1);
    saveRank(db, "greenhouse:1", 75, "Good match.");
    expect(getRankedPostings(db)).toHaveLength(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/ranking.test.ts`
Expected: FAIL — `getUnrankedPostings`, `saveRank`, `getRankedPostings` don't exist yet.

- [ ] **Step 3: Add `RankedPosting` to `src/types.ts`**

Append to the existing file:

```typescript

export interface RankedPosting extends Posting {
  rankScore: number;
  rankReason: string;
}
```

- [ ] **Step 4: Update `src/db/client.ts`** (full file)

```typescript
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
  addColumnIfMissing(db, "postings", "rank_score", "INTEGER");
  addColumnIfMissing(db, "postings", "rank_reason", "TEXT");
  return db;
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

- [ ] **Step 5: Update `src/db/postings.ts`** (full file)

```typescript
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/db/ranking.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full suite to confirm nothing in Phase 1 broke**

Run: `npm test`
Expected: all previous Phase 1 tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/client.ts src/db/postings.ts src/types.ts test/db/ranking.test.ts
git commit -m "feat: add ranking storage with additive schema migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Filter config loader + title filter

**Files:**
- Create: `src/config/filters.ts`
- Create: `config/filters.example.json`
- Create: `src/filter.ts`
- Test: `test/config/filters.test.ts`
- Test: `test/filter.test.ts`

**Interfaces:**
- Consumes: `Posting` from `src/types.ts`.
- Produces: `FilterConfig { includeKeywords: string[]; excludeKeywords: string[] }`; `loadFilterConfig(path: string): FilterConfig`; `passesTitleFilter(posting: Pick<Posting, "title">, filters: FilterConfig): boolean`.

- [ ] **Step 1: Write `config/filters.example.json`**

```json
{
  "includeKeywords": ["engineer", "developer"],
  "excludeKeywords": ["staff", "principal", "intern"]
}
```

- [ ] **Step 2: Write the failing test for the config loader**

`test/config/filters.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFilterConfig } from "../../src/config/filters.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): string {
  tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-filters-test-"));
  const filePath = join(tmpDir, "filters.json");
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

describe("loadFilterConfig", () => {
  it("parses a valid config file", () => {
    const filePath = writeConfig({ includeKeywords: ["engineer"], excludeKeywords: ["intern"] });
    expect(loadFilterConfig(filePath)).toEqual({
      includeKeywords: ["engineer"],
      excludeKeywords: ["intern"],
    });
  });

  it("defaults missing keyword lists to empty arrays", () => {
    const filePath = writeConfig({});
    expect(loadFilterConfig(filePath)).toEqual({ includeKeywords: [], excludeKeywords: [] });
  });

  it("throws when the file doesn't exist", () => {
    expect(() => loadFilterConfig("/nonexistent/filters.json")).toThrow(
      /could not read filter config/i
    );
  });

  it("throws when a keyword list contains a non-string", () => {
    const filePath = writeConfig({ includeKeywords: ["engineer", 5] });
    expect(() => loadFilterConfig(filePath)).toThrow(/includeKeywords/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/config/filters.test.ts`
Expected: FAIL — `src/config/filters.ts` does not exist yet.

- [ ] **Step 4: Implement `src/config/filters.ts`**

```typescript
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/config/filters.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing test for the title filter**

`test/filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { passesTitleFilter } from "../src/filter.js";

describe("passesTitleFilter", () => {
  it("passes everything when both keyword lists are empty", () => {
    expect(
      passesTitleFilter({ title: "Anything" }, { includeKeywords: [], excludeKeywords: [] })
    ).toBe(true);
  });

  it("requires at least one include keyword to match, case-insensitively", () => {
    const filters = { includeKeywords: ["engineer"], excludeKeywords: [] };
    expect(passesTitleFilter({ title: "Software Engineer" }, filters)).toBe(true);
    expect(passesTitleFilter({ title: "SOFTWARE ENGINEER II" }, filters)).toBe(true);
    expect(passesTitleFilter({ title: "Product Manager" }, filters)).toBe(false);
  });

  it("rejects titles matching an exclude keyword, case-insensitively", () => {
    const filters = { includeKeywords: [], excludeKeywords: ["intern"] };
    expect(passesTitleFilter({ title: "Software Engineering Intern" }, filters)).toBe(false);
    expect(passesTitleFilter({ title: "Software Engineer" }, filters)).toBe(true);
  });

  it("exclude takes precedence over include", () => {
    const filters = { includeKeywords: ["engineer"], excludeKeywords: ["intern"] };
    expect(passesTitleFilter({ title: "Software Engineering Intern" }, filters)).toBe(false);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run test/filter.test.ts`
Expected: FAIL — `src/filter.ts` does not exist yet.

- [ ] **Step 8: Implement `src/filter.ts`**

```typescript
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
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run test/filter.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add src/config/filters.ts config/filters.example.json src/filter.ts test/config/filters.test.ts test/filter.test.ts
git commit -m "feat: add filter config loader and title filter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: AI client (LiteLLM wrapper)

**Files:**
- Create: `src/ai/client.ts`
- Test: `test/ai/client.test.ts`

**Interfaces:**
- Produces: `AiClient { complete(systemPrompt: string, userPrompt: string): Promise<string> }`; `createLiteLlmClient(env?: NodeJS.ProcessEnv): AiClient` — throws if `LITELLM_BASE_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL` aren't all set.

- [ ] **Step 1: Install the `openai` package**

Run:
```bash
cd "C:\Users\omode\applicationVT"
npm install openai
```

- [ ] **Step 2: Write the failing test**

`test/ai/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createLiteLlmClient } from "../../src/ai/client.js";

describe("createLiteLlmClient", () => {
  it("throws when required env vars are missing", () => {
    expect(() => createLiteLlmClient({})).toThrow(
      "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL must all be set to use AI features."
    );
  });

  it("throws when only some env vars are set", () => {
    expect(() => createLiteLlmClient({ LITELLM_BASE_URL: "http://localhost:4000" })).toThrow(
      /must all be set/
    );
  });

  it("returns a client when all env vars are set", () => {
    const client = createLiteLlmClient({
      LITELLM_BASE_URL: "http://localhost:4000",
      LITELLM_API_KEY: "test-key",
      LITELLM_MODEL: "claude-sonnet-5",
    });
    expect(typeof client.complete).toBe("function");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/ai/client.test.ts`
Expected: FAIL — `src/ai/client.ts` does not exist yet.

- [ ] **Step 4: Implement `src/ai/client.ts`**

```typescript
import OpenAI from "openai";

export interface AiClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export function createLiteLlmClient(env: NodeJS.ProcessEnv = process.env): AiClient {
  const baseURL = env.LITELLM_BASE_URL;
  const apiKey = env.LITELLM_API_KEY;
  const model = env.LITELLM_MODEL;

  if (!baseURL || !apiKey || !model) {
    throw new Error(
      "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL must all be set to use AI features."
    );
  }

  const openai = new OpenAI({ baseURL, apiKey });

  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/ai/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/ai/client.ts test/ai/client.test.ts
git commit -m "feat: add LiteLLM-backed AI client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: AI ranking logic

**Files:**
- Create: `src/ai/rank.ts`
- Test: `test/ai/rank.test.ts`

**Interfaces:**
- Consumes: `AiClient` (Task 3); `Posting` (Phase 1).
- Produces: `RankResult { score: number; reason: string }`; `rankPosting(client: AiClient, resumeText: string, posting: Pick<Posting, "title" | "company" | "descriptionHtml">): Promise<RankResult>`.

- [ ] **Step 1: Write the failing test**

`test/ai/rank.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rankPosting } from "../../src/ai/rank.js";
import type { AiClient } from "../../src/ai/client.js";

function fakeClient(response: string): AiClient {
  return { complete: vi.fn().mockResolvedValue(response) };
}

const posting = {
  title: "Software Engineer",
  company: "Example Co",
  descriptionHtml: "<p>Build <strong>great</strong> things.</p>",
};

describe("rankPosting", () => {
  it("parses a valid score/reason response", async () => {
    const client = fakeClient('{"score": 87, "reason": "Strong overlap in skills."}');
    const result = await rankPosting(client, "resume text", posting);
    expect(result).toEqual({ score: 87, reason: "Strong overlap in skills." });
  });

  it("clamps scores outside 0-100", async () => {
    const client = fakeClient('{"score": 150, "reason": "..."}');
    const result = await rankPosting(client, "resume text", posting);
    expect(result.score).toBe(100);
  });

  it("rounds non-integer scores", async () => {
    const client = fakeClient('{"score": 72.6, "reason": "..."}');
    const result = await rankPosting(client, "resume text", posting);
    expect(result.score).toBe(73);
  });

  it("throws when the response is not valid JSON", async () => {
    const client = fakeClient("not json");
    await expect(rankPosting(client, "resume text", posting)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the response is missing score or reason", async () => {
    const client = fakeClient('{"score": 80}');
    await expect(rankPosting(client, "resume text", posting)).rejects.toThrow(
      /missing score\/reason/
    );
  });

  it("strips HTML from the posting description before prompting", async () => {
    const client = fakeClient('{"score": 50, "reason": "ok"}');
    await rankPosting(client, "resume text", posting);
    const userPrompt = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(userPrompt).toContain("Build great things.");
    expect(userPrompt).not.toContain("<p>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ai/rank.test.ts`
Expected: FAIL — `src/ai/rank.ts` does not exist yet.

- [ ] **Step 3: Implement `src/ai/rank.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ai/rank.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai/rank.ts test/ai/rank.test.ts
git commit -m "feat: add AI ranking logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Rank orchestration

**Files:**
- Create: `src/rankAll.ts`
- Test: `test/rankAll.test.ts`

**Interfaces:**
- Consumes: `getUnrankedPostings`, `saveRank` (Task 1); `passesTitleFilter`, `FilterConfig` (Task 2); `AiClient` (Task 3); `rankPosting` (Task 4).
- Produces: `RankAllResult { considered: number; filteredOut: number; ranked: number; errors: number }`; `rankAll(db: Database.Database, client: AiClient, resumeText: string, filters: FilterConfig): Promise<RankAllResult>`.

- [ ] **Step 1: Write the failing test**

`test/rankAll.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting, getRankedPostings } from "../src/db/postings.js";
import { rankAll } from "../src/rankAll.js";
import type { AiClient } from "../src/ai/client.js";
import type { Posting } from "../src/types.js";

function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "greenhouse:1",
    company: "Example Co",
    ats: "greenhouse",
    title: "Software Engineer",
    location: "Remote",
    url: "https://example.com/1",
    descriptionHtml: "<p>desc</p>",
    postedAt: null,
    discoveredAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

let db: Database.Database;
const filters = { includeKeywords: [], excludeKeywords: ["intern"] };

beforeEach(() => {
  db = createDb(":memory:");
});

describe("rankAll", () => {
  it("ranks postings that pass the filter and stores the result", async () => {
    insertPosting(db, makePosting());
    const client: AiClient = {
      complete: vi.fn().mockResolvedValue('{"score": 88, "reason": "Good fit."}'),
    };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 1, filteredOut: 0, ranked: 1, errors: 0 });
    expect(getRankedPostings(db)).toMatchObject([{ id: "greenhouse:1", rankScore: 88 }]);
  });

  it("skips postings that fail the title filter without calling the AI client", async () => {
    insertPosting(db, makePosting({ title: "Software Engineering Intern" }));
    const client: AiClient = { complete: vi.fn() };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 1, filteredOut: 1, ranked: 0, errors: 0 });
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("counts AI errors without stopping the run", async () => {
    insertPosting(db, makePosting({ id: "a" }));
    insertPosting(db, makePosting({ id: "b" }));
    const client: AiClient = {
      complete: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce('{"score": 60, "reason": "ok"}'),
    };

    const result = await rankAll(db, client, "resume text", filters);

    expect(result).toEqual({ considered: 2, filteredOut: 0, ranked: 1, errors: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/rankAll.test.ts`
Expected: FAIL — `src/rankAll.ts` does not exist yet.

- [ ] **Step 3: Implement `src/rankAll.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/rankAll.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rankAll.ts test/rankAll.test.ts
git commit -m "feat: add rank orchestration across unranked postings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Resume text extraction

**Files:**
- Create: `src/resume/extractText.ts`
- Test: `test/resume/extractText.test.ts`

**Interfaces:**
- Produces: `extractResumeText(buffer: Buffer, mimeType: string): Promise<string>` — supports `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), throws for anything else.

- [ ] **Step 1: Install `pdf-parse` and `mammoth`**

Run:
```bash
cd "C:\Users\omode\applicationVT"
npm install pdf-parse mammoth
npm install -D @types/pdf-parse
```

If `npm install` reports `mammoth` already ships its own TypeScript types (no separate `@types/mammoth` package should be needed) — if `tsc` later complains about missing types for `mammoth`, add `@types/mammoth` if it exists on npm, otherwise add a local `declare module "mammoth";` ambient declaration.

- [ ] **Step 2: Write the failing test**

`test/resume/extractText.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "  Extracted PDF text.  " }),
}));
vi.mock("mammoth", () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: "  Extracted DOCX text.  " }) },
}));

const { extractResumeText } = await import("../../src/resume/extractText.js");
const pdfParse = (await import("pdf-parse")).default;
const mammoth = (await import("mammoth")).default;

describe("extractResumeText", () => {
  it("extracts text from a PDF buffer", async () => {
    const text = await extractResumeText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(text).toBe("Extracted PDF text.");
    expect(pdfParse).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("extracts text from a DOCX buffer", async () => {
    const text = await extractResumeText(
      Buffer.from("fake docx bytes"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(text).toBe("Extracted DOCX text.");
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
  });

  it("throws for unsupported mime types", async () => {
    await expect(extractResumeText(Buffer.from("x"), "text/plain")).rejects.toThrow(
      /Unsupported resume file type/
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/resume/extractText.test.ts`
Expected: FAIL — `src/resume/extractText.ts` does not exist yet.

- [ ] **Step 4: Implement `src/resume/extractText.ts`**

```typescript
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractResumeText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf": {
      const data = await pdfParse(buffer);
      return data.text.trim();
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    default:
      throw new Error(`Unsupported resume file type "${mimeType}". Upload a PDF or DOCX file.`);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/resume/extractText.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/resume/extractText.ts test/resume/extractText.test.ts
git commit -m "feat: add deterministic PDF/DOCX resume text extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Resume storage

**Files:**
- Create: `src/db/resume.ts`
- Modify: `src/db/client.ts`
- Test: `test/db/resume.test.ts`

**Interfaces:**
- Produces: `ResumeRecord { filename: string; extractedText: string; uploadedAt: string }`; `saveResume(db, resume: ResumeRecord): void`; `getResume(db): ResumeRecord | null`. `createDb` gains a `resume` table (singleton row).

- [ ] **Step 1: Write the failing test**

`test/db/resume.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../../src/db/client.js";
import { saveResume, getResume } from "../../src/db/resume.js";

let db: Database.Database;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("resume storage", () => {
  it("returns null when no resume has been uploaded", () => {
    expect(getResume(db)).toBeNull();
  });

  it("round-trips a saved resume", () => {
    saveResume(db, {
      filename: "resume.pdf",
      extractedText: "Experienced engineer.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(getResume(db)).toEqual({
      filename: "resume.pdf",
      extractedText: "Experienced engineer.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
    });
  });

  it("replaces the previous resume on a second save", () => {
    saveResume(db, {
      filename: "old.pdf",
      extractedText: "Old.",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    });
    saveResume(db, {
      filename: "new.pdf",
      extractedText: "New.",
      uploadedAt: "2026-08-11T00:00:00.000Z",
    });
    const resume = getResume(db);
    expect(resume?.filename).toBe("new.pdf");
    expect(resume?.extractedText).toBe("New.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/resume.test.ts`
Expected: FAIL — `src/db/resume.ts` does not exist yet.

- [ ] **Step 3: Update `src/db/client.ts`** (full file)

```typescript
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
    CREATE TABLE IF NOT EXISTS resume (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      filename TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
  `);
  addColumnIfMissing(db, "postings", "rank_score", "INTEGER");
  addColumnIfMissing(db, "postings", "rank_reason", "TEXT");
  return db;
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

- [ ] **Step 4: Implement `src/db/resume.ts`**

```typescript
import type Database from "better-sqlite3";

export interface ResumeRecord {
  filename: string;
  extractedText: string;
  uploadedAt: string;
}

export function saveResume(db: Database.Database, resume: ResumeRecord): void {
  db.prepare(
    `INSERT INTO resume (id, filename, extracted_text, uploaded_at)
     VALUES (1, @filename, @extractedText, @uploadedAt)
     ON CONFLICT(id) DO UPDATE SET
       filename = excluded.filename,
       extracted_text = excluded.extracted_text,
       uploaded_at = excluded.uploaded_at`
  ).run(resume);
}

export function getResume(db: Database.Database): ResumeRecord | null {
  const row = db
    .prepare(`SELECT filename, extracted_text, uploaded_at FROM resume WHERE id = 1`)
    .get() as { filename: string; extracted_text: string; uploaded_at: string } | undefined;

  if (!row) return null;
  return {
    filename: row.filename,
    extractedText: row.extracted_text,
    uploadedAt: row.uploaded_at,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/db/resume.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full suite to confirm nothing broke**

Run: `npm test`
Expected: all previous tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/client.ts src/db/resume.ts test/db/resume.test.ts
git commit -m "feat: add resume storage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Resume upload API

**Files:**
- Modify: `src/server.ts`
- Test: `test/server-resume.test.ts`

**Interfaces:**
- Consumes: `extractResumeText` (Task 6); `saveResume`, `getResume` (Task 7).
- Produces: `POST /resume` (multipart field `resume`) → `{ filename: string; extractedLength: number }`; `GET /resume` → `{ filename, uploadedAt, extractedLength }` or 404 if none uploaded.

- [ ] **Step 1: Install `multer`**

Run:
```bash
cd "C:\Users\omode\applicationVT"
npm install multer
npm install -D @types/multer
```

- [ ] **Step 2: Write the failing test**

`test/server-resume.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";

vi.mock("../src/resume/extractText.js", () => ({
  extractResumeText: vi.fn(),
}));

const { extractResumeText } = await import("../src/resume/extractText.js");
const { createServer } = await import("../src/server.js");

let db: Database.Database;

beforeEach(() => {
  db = createDb(":memory:");
  vi.mocked(extractResumeText).mockReset();
});

describe("GET /resume", () => {
  it("returns 404 when no resume has been uploaded", async () => {
    const app = createServer(db);
    const res = await request(app).get("/resume");
    expect(res.status).toBe(404);
  });
});

describe("POST /resume", () => {
  it("stores the extracted text and returns metadata", async () => {
    const extracted = "Experienced engineer with 5 years.";
    vi.mocked(extractResumeText).mockResolvedValue(extracted);
    const app = createServer(db);

    const uploadRes = await request(app)
      .post("/resume")
      .attach("resume", Buffer.from("fake pdf bytes"), {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body).toEqual({ filename: "resume.pdf", extractedLength: extracted.length });

    const statusRes = await request(app).get("/resume");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      filename: "resume.pdf",
      extractedLength: extracted.length,
    });
  });

  it("returns 400 when no file is attached", async () => {
    const app = createServer(db);
    const res = await request(app).post("/resume");
    expect(res.status).toBe(400);
  });

  it("returns 400 when extraction fails (e.g. unsupported file type)", async () => {
    vi.mocked(extractResumeText).mockRejectedValue(new Error("Unsupported resume file type"));
    const app = createServer(db);

    const res = await request(app)
      .post("/resume")
      .attach("resume", Buffer.from("plain text"), {
        filename: "resume.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported resume file type/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/server-resume.test.ts`
Expected: FAIL — `/resume` routes don't exist yet.

- [ ] **Step 4: Update `src/server.ts`** (full file)

```typescript
import express from "express";
import type { Express } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import { getAllPostings } from "./db/postings.js";
import { extractResumeText } from "./resume/extractText.js";
import { saveResume, getResume } from "./db/resume.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createServer(db: Database.Database): Express {
  const app = express();

  app.get("/api/postings", (_req, res) => {
    res.json(getAllPostings(db));
  });

  app.get("/postings", (_req, res) => {
    const postings = getAllPostings(db);
    const rows = postings
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.company)}</td>
          <td><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></td>
          <td>${escapeHtml(p.location)}</td>
          <td>${escapeHtml(p.discoveredAt)}</td>
        </tr>`
      )
      .join("\n");

    res.type("html").send(`<!doctype html>
<html>
  <head><title>Discovered Postings</title></head>
  <body>
    <h1>Discovered Postings</h1>
    <table border="1" cellpadding="6">
      <thead><tr><th>Company</th><th>Title</th><th>Location</th><th>Discovered</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`);
  });

  app.post("/resume", upload.single("resume"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Send a multipart field named "resume".' });
      return;
    }
    try {
      const extractedText = await extractResumeText(req.file.buffer, req.file.mimetype);
      if (extractedText.length === 0) {
        res.status(422).json({ error: "Could not extract any text from the uploaded file." });
        return;
      }
      saveResume(db, {
        filename: req.file.originalname,
        extractedText,
        uploadedAt: new Date().toISOString(),
      });
      res.json({ filename: req.file.originalname, extractedLength: extractedText.length });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/resume", (_req, res) => {
    const resume = getResume(db);
    if (!resume) {
      res.status(404).json({ error: "No resume uploaded yet." });
      return;
    }
    res.json({
      filename: resume.filename,
      uploadedAt: resume.uploadedAt,
      extractedLength: resume.extractedText.length,
    });
  });

  return app;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/server-resume.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full suite to confirm the existing `/postings` tests still pass**

Run: `npm test`
Expected: all tests, including Phase 1's `test/server.test.ts`, still PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server.ts test/server-resume.test.ts
git commit -m "feat: add resume upload API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Ranked queue view

**Files:**
- Modify: `src/server.ts`
- Test: `test/server-queue.test.ts`

**Interfaces:**
- Consumes: `getRankedPostings` (Task 1).
- Produces: `GET /queue` — HTML table of ranked postings sorted by score descending, showing each posting's reason.

- [ ] **Step 1: Write the failing test**

`test/server-queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting, saveRank } from "../src/db/postings.js";
import { createServer } from "../src/server.js";
import type { Posting } from "../src/types.js";

let db: Database.Database;

const posting: Posting = {
  id: "greenhouse:1",
  company: "Example Co",
  ats: "greenhouse",
  title: "Software Engineer",
  location: "Remote",
  url: "https://example.com/1",
  descriptionHtml: "<p>desc</p>",
  postedAt: null,
  discoveredAt: "2026-08-11T00:00:00.000Z",
};

beforeEach(() => {
  db = createDb(":memory:");
});

describe("GET /queue", () => {
  it("lists ranked postings sorted by score with their reason", async () => {
    insertPosting(db, posting);
    insertPosting(db, { ...posting, id: "greenhouse:2", title: "Data Scientist" });
    saveRank(db, "greenhouse:1", 40, "Partial match.");
    saveRank(db, "greenhouse:2", 90, "Excellent match.");

    const app = createServer(db);
    const res = await request(app).get("/queue");

    expect(res.status).toBe(200);
    const dataScientistIndex = res.text.indexOf("Data Scientist");
    const softwareEngineerIndex = res.text.indexOf("Software Engineer");
    expect(dataScientistIndex).toBeGreaterThan(-1);
    expect(dataScientistIndex).toBeLessThan(softwareEngineerIndex);
    expect(res.text).toContain("Excellent match.");
  });

  it("excludes unranked postings", async () => {
    insertPosting(db, posting);
    const app = createServer(db);
    const res = await request(app).get("/queue");
    expect(res.text).not.toContain("Software Engineer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/server-queue.test.ts`
Expected: FAIL — `/queue` route doesn't exist yet.

- [ ] **Step 3: Add the `/queue` route to `src/server.ts`**

Add this import alongside the existing ones at the top of the file:

```typescript
import { getAllPostings, getRankedPostings } from "./db/postings.js";
```

(replacing the existing `import { getAllPostings } from "./db/postings.js";` line)

Add this route inside `createServer`, after the `/postings` route and before `/resume`:

```typescript
  app.get("/queue", (_req, res) => {
    const ranked = getRankedPostings(db);
    const rows = ranked
      .map(
        (p) => `<tr>
          <td>${p.rankScore}</td>
          <td>${escapeHtml(p.company)}</td>
          <td><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></td>
          <td>${escapeHtml(p.location)}</td>
          <td>${escapeHtml(p.rankReason)}</td>
        </tr>`
      )
      .join("\n");

    res.type("html").send(`<!doctype html>
<html>
  <head><title>Ranked Queue</title></head>
  <body>
    <h1>Ranked Queue</h1>
    <table border="1" cellpadding="6">
      <thead><tr><th>Score</th><th>Company</th><th>Title</th><th>Location</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/server-queue.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite to confirm nothing broke**

Run: `npm test`
Expected: all tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts test/server-queue.test.ts
git commit -m "feat: add ranked queue view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Wire `/rank`, LiteLLM setup docs, and manual verification

**Files:**
- Modify: `src/index.ts`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: `rankAll` (Task 5); `createLiteLlmClient` (Task 3); `loadFilterConfig` (Task 2); `getResume` (Task 7).
- Produces: the fully wired application; `POST /rank` endpoint.

This task is a composition root change (env vars, route wiring) plus documentation, verified by manual smoke testing rather than a unit test — consistent with how `/scrape` and the scheduler were verified in Phase 1's Task 8.

- [ ] **Step 1: Add `config/filters.json` to `.gitignore`**

Edit `.gitignore` — add this line after `config/companies.json`:

```
config/filters.json
```

Full file:

```
node_modules/
dist/
data/
*.sqlite3
config/companies.json
config/filters.json
```

- [ ] **Step 2: Update `src/index.ts`** (full file)

```typescript
import cron from "node-cron";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDb } from "./db/client.js";
import { loadCompanyConfig } from "./config/companies.js";
import { loadFilterConfig } from "./config/filters.js";
import { scrapeAll } from "./scrapeAll.js";
import { rankAll } from "./rankAll.js";
import { createLiteLlmClient } from "./ai/client.js";
import { getResume } from "./db/resume.js";
import { createServer } from "./server.js";

const DB_PATH = process.env.DB_PATH ?? "data/applicationvt.sqlite3";
const COMPANIES_PATH = process.env.COMPANIES_PATH ?? "config/companies.json";
const FILTERS_PATH = process.env.FILTERS_PATH ?? "config/filters.json";
const PORT = Number(process.env.PORT ?? 3000);
const SCRAPE_CRON = process.env.SCRAPE_CRON ?? "0 6 * * *"; // daily at 06:00

async function main(): Promise<void> {
  if (DB_PATH !== ":memory:") {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }
  const db = createDb(DB_PATH);
  const companies = loadCompanyConfig(COMPANIES_PATH);

  const app = createServer(db);

  app.post("/scrape", (_req, res) => {
    scrapeAll(db, companies).then(
      (results) => res.json(results),
      (err) => res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
  });

  app.post("/rank", (_req, res) => {
    const resume = getResume(db);
    if (!resume) {
      res.status(400).json({ error: "Upload a resume via POST /resume before ranking." });
      return;
    }

    let client;
    try {
      client = createLiteLlmClient();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    let filters;
    try {
      filters = loadFilterConfig(FILTERS_PATH);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    rankAll(db, client, resume.extractedText, filters).then(
      (result) => res.json(result),
      (err) => res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
  });

  app.listen(PORT, () => {
    console.log(`applicationVT listening on http://localhost:${PORT}`);
    console.log(`View discovered postings at http://localhost:${PORT}/postings`);
    console.log(`View ranked queue at http://localhost:${PORT}/queue`);
  });

  cron.schedule(SCRAPE_CRON, () => {
    console.log("Running scheduled scrape...");
    scrapeAll(db, companies).then((results) => {
      console.log("Scrape complete:", results);
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Update `README.md`** (full file)

```markdown
# applicationVT

Scrapes job postings directly from configured companies' Greenhouse and
Lever job boards, ranks them against your resume using AI, and lists them
in order of relevance.

## Setup

1. Install dependencies: `npm install`
2. Copy the example configs and fill in your own values:
   ```bash
   cp config/companies.example.json config/companies.json
   cp config/filters.example.json config/filters.json
   ```
   For each company in `companies.json`, find its `ats` and `identifier`:
   - **Greenhouse**: careers URL looks like `boards.greenhouse.io/<identifier>`
   - **Lever**: careers URL looks like `jobs.lever.co/<identifier>`

   In `filters.json`, list title keywords: `includeKeywords` (a posting's
   title must contain at least one, if the list isn't empty) and
   `excludeKeywords` (a posting is dropped if its title contains any).
3. Set up a local LiteLLM proxy for AI ranking:
   ```bash
   pip install "litellm[proxy]"
   ```
   Create a `litellm-config.yaml` (not committed — it holds your provider
   keys) like:
   ```yaml
   model_list:
     - model_name: claude-sonnet-5
       litellm_params:
         model: anthropic/claude-sonnet-5
         api_key: sk-ant-...
   ```
   Then run: `litellm --config litellm-config.yaml --port 4000`
4. Set the AI environment variables before starting the app:
   ```bash
   export LITELLM_BASE_URL=http://localhost:4000
   export LITELLM_API_KEY=anything
   export LITELLM_MODEL=claude-sonnet-5
   ```
5. Run the app: `npm run dev`

## Using it

- Trigger a scrape: `curl -X POST http://localhost:3000/scrape`
- View discovered postings: http://localhost:3000/postings
- Upload your resume (PDF or DOCX):
  ```bash
  curl -X POST http://localhost:3000/resume -F "resume=@/path/to/your/resume.pdf"
  ```
- Check resume status: `curl http://localhost:3000/resume`
- Rank discovered postings against your resume:
  `curl -X POST http://localhost:3000/rank`
- View the ranked queue, sorted by relevance: http://localhost:3000/queue

A scrape also runs automatically every day at 06:00 (server time). Override
the schedule with the `SCRAPE_CRON` environment variable (cron syntax).

## Testing

`npm test`
```

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full automated test suite**

Run: `npm test`
Expected: all tests from Tasks 1–9 (and Phase 1) PASS.

- [ ] **Step 6: Manually verify server wiring without requiring a live LiteLLM proxy**

Run:
```bash
npm run dev
```

In a separate terminal:
```bash
curl http://localhost:3000/resume
curl -X POST http://localhost:3000/rank
```

Expected: `GET /resume` returns a 404 with `{"error":"No resume uploaded yet."}` (assuming no resume has been uploaded to this database yet); `POST /rank` returns a 400 with `{"error":"Upload a resume via POST /resume before ranking."}`. This confirms the routes are wired correctly without needing a real LiteLLM proxy or provider key running yet.

If a real resume file is available, also verify the upload path:
```bash
curl -X POST http://localhost:3000/resume -F "resume=@<path-to-a-real-pdf-or-docx>"
curl http://localhost:3000/resume
```
Expected: both calls return 200 with the filename and a non-zero `extractedLength`.

Stop the dev server (Ctrl+C) once verified. Full live AI ranking (`POST /rank` actually scoring postings) requires the user to have completed the LiteLLM proxy setup in the README with a real provider key — that verification happens once they're ready to run it for real, not as part of this automated implementation step.

- [ ] **Step 7: Commit**

```bash
git add .gitignore src/index.ts README.md
git commit -m "feat: wire up /rank route and document LiteLLM setup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
