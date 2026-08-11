# Phase 1 — Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the first working slice of the job application assistant: a scheduled scraper that pulls postings directly from configured companies' Greenhouse and Lever job boards, stores them deduped in a local database, and exposes them through a simple list view — with nothing yet filtered, ranked, or AI-touched.

**Architecture:** A single Node.js/TypeScript backend service: a company-source config file drives per-ATS scraper clients (Greenhouse and Lever both expose public JSON job-board APIs, so these are typed HTTP clients, not HTML scraping), results are normalized to one `Posting` shape, deduped against what's already stored, and persisted to a local SQLite database. An Express server exposes the stored postings as JSON and as a plain HTML list. A cron schedule and a manual trigger route both call the same scrape pipeline.

**Tech Stack:** TypeScript (Node.js 20+, ESM/NodeNext), Express, better-sqlite3, node-cron, Vitest + supertest for testing, tsx for running TS directly in dev.

## Global Constraints

- Personal, single-user tool — no auth, no multi-tenancy.
- TypeScript end-to-end, per the design spec's tech stack decision (`docs/superpowers/specs/2026-08-11-job-application-assistant-design.md`).
- The tracked-company list is config-driven (a JSON file); adding a company must be a config edit, not a code change.
- Scrapers are implemented per ATS platform, not per company — Phase 1 covers Greenhouse and Lever; more platforms can be added later without touching per-company logic.
- Duplicate postings are detected by a normalized `company + title + location` signature (per the spec's dedupe rule).
- One source failing to scrape must not block scraping the others.

## Scope note

The design spec's "Discovery" grouping also mentioned the Profile/Resume Manager. It's intentionally **not** in this plan: nothing built here reads resume data — it's first needed in Phase 2 (AI relevance ranking against the resume). Building storage for it now would sit unused for a full phase, so it moves to open Phase 2 instead.

---

### Task 1: Project scaffolding + shared types + dedupe logic

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/types.ts`
- Create: `src/dedupe.ts`
- Test: `test/dedupe.test.ts`

**Interfaces:**
- Produces: `AtsPlatform = "greenhouse" | "lever"`; `CompanySource { name: string; ats: AtsPlatform; identifier: string }`; `Posting { id: string; company: string; ats: AtsPlatform; title: string; location: string; url: string; descriptionHtml: string; postedAt: string | null; discoveredAt: string }`; `dedupeKey(posting: Pick<Posting, "company"|"title"|"location">): string`; `dedupePostings(postings: Posting[], existingKeys: Set<string>): Posting[]`.

- [ ] **Step 1: Initialize the project and install dependencies**

Run:
```bash
cd "C:\Users\omode\applicationVT"
npm init -y
npm install better-sqlite3 express node-cron
npm install -D typescript vitest tsx supertest @types/node @types/express @types/better-sqlite3 @types/node-cron @types/supertest
```

- [ ] **Step 2: Write `package.json` scripts and module type**

Edit `package.json` so it reads:

```json
{
  "name": "applicationvt",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

Keep the `dependencies`/`devDependencies` that `npm install` already wrote into the file — only replace the top-level `name`/`version`/`scripts` fields shown above.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
data/
*.sqlite3
```

- [ ] **Step 6: Write `src/types.ts`**

```typescript
export type AtsPlatform = "greenhouse" | "lever";

export interface CompanySource {
  name: string;
  ats: AtsPlatform;
  /** Greenhouse board token or Lever company slug, depending on `ats`. */
  identifier: string;
}

export interface Posting {
  /** Stable id, e.g. `greenhouse:123456` or `lever:abcd-1234`. */
  id: string;
  company: string;
  ats: AtsPlatform;
  title: string;
  location: string;
  url: string;
  descriptionHtml: string;
  /** ISO date string, or null if the source didn't provide one. */
  postedAt: string | null;
  /** ISO date string of when we scraped it. */
  discoveredAt: string;
}
```

- [ ] **Step 7: Write the failing test for dedupe logic**

`test/dedupe.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dedupeKey, dedupePostings } from "../src/dedupe.js";
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

describe("dedupeKey", () => {
  it("normalizes case and whitespace", () => {
    const a = dedupeKey({ company: "Example Co", title: "Software Engineer", location: "Remote" });
    const b = dedupeKey({ company: "  example   co ", title: "software engineer", location: "REMOTE" });
    expect(a).toBe(b);
  });

  it("differs when company, title, or location differ", () => {
    const base = dedupeKey({ company: "Example Co", title: "Software Engineer", location: "Remote" });
    expect(dedupeKey({ company: "Other Co", title: "Software Engineer", location: "Remote" })).not.toBe(base);
    expect(dedupeKey({ company: "Example Co", title: "Data Scientist", location: "Remote" })).not.toBe(base);
    expect(dedupeKey({ company: "Example Co", title: "Software Engineer", location: "NYC" })).not.toBe(base);
  });
});

describe("dedupePostings", () => {
  it("drops postings whose key is already in existingKeys", () => {
    const existing = new Set([dedupeKey(makePosting())]);
    const result = dedupePostings([makePosting({ id: "greenhouse:2" })], existing);
    expect(result).toEqual([]);
  });

  it("drops duplicates within the input list, keeping the first occurrence", () => {
    const first = makePosting({ id: "greenhouse:1" });
    const duplicate = makePosting({ id: "lever:1" }); // same company/title/location, different id
    const result = dedupePostings([first, duplicate], new Set());
    expect(result).toEqual([first]);
  });

  it("keeps postings that are genuinely new", () => {
    const posting = makePosting();
    const result = dedupePostings([posting], new Set());
    expect(result).toEqual([posting]);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run test/dedupe.test.ts`
Expected: FAIL — `src/dedupe.ts` does not exist yet (module not found).

- [ ] **Step 9: Implement `src/dedupe.ts`**

```typescript
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
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run test/dedupe.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/types.ts src/dedupe.ts test/dedupe.test.ts
git commit -m "feat: scaffold project, add shared types and dedupe logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Company source config loader

**Files:**
- Create: `src/config/companies.ts`
- Create: `config/companies.example.json`
- Test: `test/config/companies.test.ts`

**Interfaces:**
- Consumes: `CompanySource`, `AtsPlatform` from `src/types.ts` (Task 1).
- Produces: `loadCompanyConfig(path: string): CompanySource[]` — throws `Error` with a descriptive message on missing file or invalid entries.

- [ ] **Step 1: Write `config/companies.example.json`**

```json
[
  {
    "name": "Example Co",
    "ats": "greenhouse",
    "identifier": "exampleco"
  },
  {
    "name": "Another Co",
    "ats": "lever",
    "identifier": "anotherco"
  }
]
```

- [ ] **Step 2: Write the failing test**

`test/config/companies.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompanyConfig } from "../../src/config/companies.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): string {
  tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-test-"));
  const filePath = join(tmpDir, "companies.json");
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

describe("loadCompanyConfig", () => {
  it("parses a valid config file", () => {
    const filePath = writeConfig([
      { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
      { name: "Another Co", ats: "lever", identifier: "anotherco" },
    ]);

    expect(loadCompanyConfig(filePath)).toEqual([
      { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
      { name: "Another Co", ats: "lever", identifier: "anotherco" },
    ]);
  });

  it("throws when the file doesn't exist", () => {
    expect(() => loadCompanyConfig("/nonexistent/companies.json")).toThrow(
      /could not read company config/i
    );
  });

  it("throws when an entry is missing a required field", () => {
    const filePath = writeConfig([{ name: "Example Co", ats: "greenhouse" }]);
    expect(() => loadCompanyConfig(filePath)).toThrow(/entry 0/i);
  });

  it("throws when an entry has an unsupported ats value", () => {
    const filePath = writeConfig([{ name: "Example Co", ats: "workday", identifier: "x" }]);
    expect(() => loadCompanyConfig(filePath)).toThrow(/unsupported ats/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/config/companies.test.ts`
Expected: FAIL — `src/config/companies.ts` does not exist yet.

- [ ] **Step 4: Implement `src/config/companies.ts`**

```typescript
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/config/companies.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/config/companies.ts config/companies.example.json test/config/companies.test.ts
git commit -m "feat: add company source config loader

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: SQLite storage for postings

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/postings.ts`
- Test: `test/db/postings.test.ts`

**Interfaces:**
- Consumes: `Posting` from `src/types.ts` (Task 1); `dedupeKey` from `src/dedupe.ts` (Task 1).
- Produces: `createDb(path: string): Database.Database`; `insertPosting(db, posting: Posting): void`; `getAllPostings(db): Posting[]` (ordered by `discoveredAt` descending); `getAllDedupeKeys(db): Set<string>`.

- [ ] **Step 1: Write the failing test**

`test/db/postings.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../../src/db/client.js";
import { insertPosting, getAllPostings, getAllDedupeKeys } from "../../src/db/postings.js";
import type { Posting } from "../../src/types.js";

let db: Database.Database;

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

beforeEach(() => {
  db = createDb(":memory:");
});

describe("postings storage", () => {
  it("round-trips a posting through insert and getAllPostings", () => {
    insertPosting(db, makePosting());
    expect(getAllPostings(db)).toEqual([makePosting()]);
  });

  it("ignores a second insert with the same id", () => {
    insertPosting(db, makePosting());
    insertPosting(db, makePosting({ title: "Different Title" }));
    expect(getAllPostings(db)).toHaveLength(1);
    expect(getAllPostings(db)[0].title).toBe("Software Engineer");
  });

  it("orders results by discoveredAt descending", () => {
    insertPosting(db, makePosting({ id: "a", discoveredAt: "2026-08-01T00:00:00.000Z" }));
    insertPosting(db, makePosting({ id: "b", discoveredAt: "2026-08-05T00:00:00.000Z" }));
    expect(getAllPostings(db).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("getAllDedupeKeys returns the dedupe key for every stored posting", () => {
    insertPosting(db, makePosting());
    const keys = getAllDedupeKeys(db);
    expect(keys.has("example co|software engineer|remote")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/postings.test.ts`
Expected: FAIL — `src/db/client.ts` and `src/db/postings.ts` do not exist yet.

- [ ] **Step 3: Implement `src/db/client.ts`**

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
  return db;
}
```

- [ ] **Step 4: Implement `src/db/postings.ts`**

```typescript
import type Database from "better-sqlite3";
import type { Posting } from "../types.js";
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/db/postings.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts src/db/postings.ts test/db/postings.test.ts
git commit -m "feat: add SQLite storage for postings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Greenhouse scraper client

**Files:**
- Create: `src/scrapers/greenhouse.ts`
- Create: `test/fixtures/greenhouse-sample.json`
- Test: `test/scrapers/greenhouse.test.ts`

**Interfaces:**
- Consumes: `Posting`, `CompanySource` from `src/types.ts` (Task 1).
- Produces: `fetchGreenhousePostings(source: CompanySource, now?: () => string): Promise<Posting[]>`.

Greenhouse exposes a public JSON API per board: `https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`. The board token is the segment right after `boards.greenhouse.io/` in the company's careers URL.

- [ ] **Step 1: Write the fixture**

`test/fixtures/greenhouse-sample.json`:

```json
{
  "jobs": [
    {
      "id": 123456,
      "title": "Software Engineer",
      "location": { "name": "Remote" },
      "absolute_url": "https://boards.greenhouse.io/exampleco/jobs/123456",
      "content": "<p>We are hiring a Software Engineer.</p>",
      "updated_at": "2026-08-01T12:00:00Z"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`test/scrapers/greenhouse.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fetchGreenhousePostings } from "../../src/scrapers/greenhouse.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/greenhouse-sample.json", import.meta.url), "utf-8")
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGreenhousePostings", () => {
  it("normalizes Greenhouse jobs into Postings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fixture,
      })
    );

    const postings = await fetchGreenhousePostings(
      { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
      () => "2026-08-11T00:00:00.000Z"
    );

    expect(postings).toEqual([
      {
        id: "greenhouse:123456",
        company: "Example Co",
        ats: "greenhouse",
        title: "Software Engineer",
        location: "Remote",
        url: "https://boards.greenhouse.io/exampleco/jobs/123456",
        descriptionHtml: "<p>We are hiring a Software Engineer.</p>",
        postedAt: "2026-08-01T12:00:00Z",
        discoveredAt: "2026-08-11T00:00:00.000Z",
      },
    ]);
  });

  it("throws a descriptive error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" })
    );

    await expect(
      fetchGreenhousePostings({ name: "Example Co", ats: "greenhouse", identifier: "exampleco" })
    ).rejects.toThrow("Greenhouse fetch failed for exampleco: 404 Not Found");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/scrapers/greenhouse.test.ts`
Expected: FAIL — `src/scrapers/greenhouse.ts` does not exist yet.

- [ ] **Step 4: Implement `src/scrapers/greenhouse.ts`**

```typescript
import type { CompanySource, Posting } from "../types.js";

interface GreenhouseJob {
  id: number;
  title: string;
  location: { name: string } | null;
  absolute_url: string;
  content: string;
  updated_at: string | null;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export async function fetchGreenhousePostings(
  source: CompanySource,
  now: () => string = () => new Date().toISOString()
): Promise<Posting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.identifier}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Greenhouse fetch failed for ${source.identifier}: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as GreenhouseResponse;
  const discoveredAt = now();

  return data.jobs.map((job) => ({
    id: `greenhouse:${job.id}`,
    company: source.name,
    ats: "greenhouse" as const,
    title: job.title,
    location: job.location?.name ?? "Unknown",
    url: job.absolute_url,
    descriptionHtml: job.content,
    postedAt: job.updated_at ?? null,
    discoveredAt,
  }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/scrapers/greenhouse.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/greenhouse.ts test/fixtures/greenhouse-sample.json test/scrapers/greenhouse.test.ts
git commit -m "feat: add Greenhouse scraper client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Lever scraper client

**Files:**
- Create: `src/scrapers/lever.ts`
- Create: `test/fixtures/lever-sample.json`
- Test: `test/scrapers/lever.test.ts`

**Interfaces:**
- Consumes: `Posting`, `CompanySource` from `src/types.ts` (Task 1).
- Produces: `fetchLeverPostings(source: CompanySource, now?: () => string): Promise<Posting[]>`.

Lever exposes a public JSON API per company: `https://api.lever.co/v0/postings/{company}?mode=json`. The company slug is the segment right after `jobs.lever.co/` in the company's careers URL.

- [ ] **Step 1: Write the fixture**

`test/fixtures/lever-sample.json`:

```json
[
  {
    "id": "abcd-1234",
    "text": "Product Manager",
    "categories": { "location": "New York" },
    "description": "<p>We are hiring a Product Manager.</p>",
    "hostedUrl": "https://jobs.lever.co/anotherco/abcd-1234",
    "createdAt": 1722470400000
  }
]
```

- [ ] **Step 2: Write the failing test**

`test/scrapers/lever.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fetchLeverPostings } from "../../src/scrapers/lever.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/lever-sample.json", import.meta.url), "utf-8")
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLeverPostings", () => {
  it("normalizes Lever postings into Postings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fixture,
      })
    );

    const postings = await fetchLeverPostings(
      { name: "Another Co", ats: "lever", identifier: "anotherco" },
      () => "2026-08-11T00:00:00.000Z"
    );

    expect(postings).toEqual([
      {
        id: "lever:abcd-1234",
        company: "Another Co",
        ats: "lever",
        title: "Product Manager",
        location: "New York",
        url: "https://jobs.lever.co/anotherco/abcd-1234",
        descriptionHtml: "<p>We are hiring a Product Manager.</p>",
        postedAt: new Date(1722470400000).toISOString(),
        discoveredAt: "2026-08-11T00:00:00.000Z",
      },
    ]);
  });

  it("throws a descriptive error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" })
    );

    await expect(
      fetchLeverPostings({ name: "Another Co", ats: "lever", identifier: "anotherco" })
    ).rejects.toThrow("Lever fetch failed for anotherco: 500 Server Error");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/scrapers/lever.test.ts`
Expected: FAIL — `src/scrapers/lever.ts` does not exist yet.

- [ ] **Step 4: Implement `src/scrapers/lever.ts`**

```typescript
import type { CompanySource, Posting } from "../types.js";

interface LeverPosting {
  id: string;
  text: string;
  categories: { location?: string } | null;
  description: string;
  hostedUrl: string;
  createdAt: number | null;
}

export async function fetchLeverPostings(
  source: CompanySource,
  now: () => string = () => new Date().toISOString()
): Promise<Posting[]> {
  const url = `https://api.lever.co/v0/postings/${source.identifier}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Lever fetch failed for ${source.identifier}: ${res.status} ${res.statusText}`
    );
  }
  const jobs = (await res.json()) as LeverPosting[];
  const discoveredAt = now();

  return jobs.map((job) => ({
    id: `lever:${job.id}`,
    company: source.name,
    ats: "lever" as const,
    title: job.text,
    location: job.categories?.location ?? "Unknown",
    url: job.hostedUrl,
    descriptionHtml: job.description,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    discoveredAt,
  }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/scrapers/lever.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/lever.ts test/fixtures/lever-sample.json test/scrapers/lever.test.ts
git commit -m "feat: add Lever scraper client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Scrape orchestration

**Files:**
- Create: `src/scrapeAll.ts`
- Test: `test/scrapeAll.test.ts`

**Interfaces:**
- Consumes: `CompanySource`, `Posting` (Task 1); `fetchGreenhousePostings` (Task 4); `fetchLeverPostings` (Task 5); `dedupePostings` (Task 1); `getAllDedupeKeys`, `insertPosting`, `createDb` (Task 3).
- Produces: `ScrapeResult { company: string; postingsFound: number; postingsInserted: number; error?: string }`; `scrapeAll(db: Database.Database, companies: CompanySource[]): Promise<ScrapeResult[]>`.

- [ ] **Step 1: Write the failing test**

`test/scrapeAll.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { getAllPostings } from "../src/db/postings.js";
import type { CompanySource, Posting } from "../src/types.js";

vi.mock("../src/scrapers/greenhouse.js", () => ({
  fetchGreenhousePostings: vi.fn(),
}));
vi.mock("../src/scrapers/lever.js", () => ({
  fetchLeverPostings: vi.fn(),
}));

const { fetchGreenhousePostings } = await import("../src/scrapers/greenhouse.js");
const { fetchLeverPostings } = await import("../src/scrapers/lever.js");
const { scrapeAll } = await import("../src/scrapeAll.js");

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
const companies: CompanySource[] = [
  { name: "Example Co", ats: "greenhouse", identifier: "exampleco" },
  { name: "Another Co", ats: "lever", identifier: "anotherco" },
];

beforeEach(() => {
  db = createDb(":memory:");
  vi.mocked(fetchGreenhousePostings).mockReset();
  vi.mocked(fetchLeverPostings).mockReset();
});

describe("scrapeAll", () => {
  it("scrapes each company with the right client and stores new postings", async () => {
    vi.mocked(fetchGreenhousePostings).mockResolvedValue([makePosting({ id: "greenhouse:1" })]);
    vi.mocked(fetchLeverPostings).mockResolvedValue([
      makePosting({ id: "lever:1", company: "Another Co", ats: "lever" }),
    ]);

    const results = await scrapeAll(db, companies);

    expect(results).toEqual([
      { company: "Example Co", postingsFound: 1, postingsInserted: 1 },
      { company: "Another Co", postingsFound: 1, postingsInserted: 1 },
    ]);
    expect(getAllPostings(db)).toHaveLength(2);
  });

  it("continues scraping other companies when one fails", async () => {
    vi.mocked(fetchGreenhousePostings).mockRejectedValue(new Error("boom"));
    vi.mocked(fetchLeverPostings).mockResolvedValue([
      makePosting({ id: "lever:1", company: "Another Co", ats: "lever" }),
    ]);

    const results = await scrapeAll(db, companies);

    expect(results).toEqual([
      { company: "Example Co", postingsFound: 0, postingsInserted: 0, error: "boom" },
      { company: "Another Co", postingsFound: 1, postingsInserted: 1 },
    ]);
    expect(getAllPostings(db)).toHaveLength(1);
  });

  it("does not re-insert postings that already exist", async () => {
    vi.mocked(fetchGreenhousePostings).mockResolvedValue([makePosting({ id: "greenhouse:1" })]);
    vi.mocked(fetchLeverPostings).mockResolvedValue([]);

    await scrapeAll(db, [companies[0]]);
    const results = await scrapeAll(db, [companies[0]]);

    expect(results).toEqual([{ company: "Example Co", postingsFound: 1, postingsInserted: 0 }]);
    expect(getAllPostings(db)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scrapeAll.test.ts`
Expected: FAIL — `src/scrapeAll.ts` does not exist yet.

- [ ] **Step 3: Implement `src/scrapeAll.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scrapeAll.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scrapeAll.ts test/scrapeAll.test.ts
git commit -m "feat: add scrape orchestration across configured companies

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Express server exposing stored postings

**Files:**
- Create: `src/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `getAllPostings` from `src/db/postings.ts` (Task 3); `insertPosting`, `createDb` (Task 3, for test setup).
- Produces: `createServer(db: Database.Database): express.Express` with routes `GET /api/postings` (JSON) and `GET /postings` (HTML table).

- [ ] **Step 1: Write the failing test**

`test/server.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/client.js";
import { insertPosting } from "../src/db/postings.js";
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
  insertPosting(db, posting);
});

describe("GET /api/postings", () => {
  it("returns stored postings as JSON", async () => {
    const app = createServer(db);
    const res = await request(app).get("/api/postings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([posting]);
  });
});

describe("GET /postings", () => {
  it("returns an HTML page listing the postings", async () => {
    const app = createServer(db);
    const res = await request(app).get("/postings");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Software Engineer");
    expect(res.text).toContain("Example Co");
  });

  it("escapes HTML in posting fields", async () => {
    db = createDb(":memory:");
    insertPosting(db, { ...posting, id: "greenhouse:2", title: "<script>alert(1)</script>" });
    const app = createServer(db);
    const res = await request(app).get("/postings");
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — `src/server.ts` does not exist yet.

- [ ] **Step 3: Implement `src/server.ts`**

```typescript
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { getAllPostings } from "./db/postings.js";

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat: add Express server exposing stored postings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Entrypoint — scheduler, manual trigger, and README

**Files:**
- Create: `src/index.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `createDb` (Task 3), `loadCompanyConfig` (Task 2), `scrapeAll` (Task 6), `createServer` (Task 7).
- Produces: the running application; no new exports consumed by later tasks (Phase 2 will read from the same `src/db/*` and `src/types.ts` modules directly).

This task wires everything into a runnable service. Since it's a composition root (reads env vars, starts a server, schedules a cron job) rather than a pure function, it's verified by manual smoke testing instead of a unit test.

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
import cron from "node-cron";
import { createDb } from "./db/client.js";
import { loadCompanyConfig } from "./config/companies.js";
import { scrapeAll } from "./scrapeAll.js";
import { createServer } from "./server.js";

const DB_PATH = process.env.DB_PATH ?? "data/applicationvt.sqlite3";
const COMPANIES_PATH = process.env.COMPANIES_PATH ?? "config/companies.json";
const PORT = Number(process.env.PORT ?? 3000);
const SCRAPE_CRON = process.env.SCRAPE_CRON ?? "0 6 * * *"; // daily at 06:00

async function main(): Promise<void> {
  const db = createDb(DB_PATH);
  const companies = loadCompanyConfig(COMPANIES_PATH);

  const app = createServer(db);

  app.post("/scrape", (_req, res) => {
    scrapeAll(db, companies).then(
      (results) => res.json(results),
      (err) => res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    );
  });

  app.listen(PORT, () => {
    console.log(`applicationVT listening on http://localhost:${PORT}`);
    console.log(`View discovered postings at http://localhost:${PORT}/postings`);
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

- [ ] **Step 2: Write `README.md`**

```markdown
# applicationVT — Phase 1: Discovery

Scrapes job postings directly from configured companies' Greenhouse and
Lever job boards, dedupes them, and lists them.

## Setup

1. Install dependencies: `npm install`
2. Copy the example company config and fill in your target companies:
   ```bash
   cp config/companies.example.json config/companies.json
   ```
   For each company, find its `ats` and `identifier`:
   - **Greenhouse**: careers URL looks like `boards.greenhouse.io/<identifier>`
   - **Lever**: careers URL looks like `jobs.lever.co/<identifier>`
3. Run the app: `npm run dev`
4. Open http://localhost:3000/postings — empty until the first scrape runs.
5. Trigger a scrape manually: `curl -X POST http://localhost:3000/scrape`
6. Refresh http://localhost:3000/postings to see results.

A scrape also runs automatically every day at 06:00 (server time). Override
the schedule with the `SCRAPE_CRON` environment variable (cron syntax).

## Testing

`npm test`
```

- [ ] **Step 3: Manually verify end-to-end**

Run:
```bash
cp config/companies.example.json config/companies.json
npm run dev
```

In a separate terminal:
```bash
curl -X POST http://localhost:3000/scrape
curl http://localhost:3000/api/postings
```

Expected: the `POST /scrape` call returns a JSON array of `ScrapeResult` objects (one per configured company, each with `postingsFound`/`postingsInserted` and no `error` field for a working example config); `GET /api/postings` returns the stored postings. Opening `http://localhost:3000/postings` in a browser shows the same postings as an HTML table.

Stop the dev server (Ctrl+C) once verified.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests from Tasks 1–7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: wire up entrypoint with scheduler and manual scrape trigger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
