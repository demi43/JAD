# Phase 2b — Auto-managed LiteLLM Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "hand-write a LiteLLM `config.yaml` and run it yourself" setup with: set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (any subset) as env vars, and the app generates the proxy config and starts/stops the proxy itself as part of `npm run dev`/`npm start`.

**Architecture:** A pure config-builder turns whichever provider keys are present into a LiteLLM proxy config (one wildcard model entry per provider, e.g. `anthropic/*`, so any model name under that provider works without enumerating specific models). A process manager writes that config to a gitignored file, spawns the `litellm` CLI as a child process, polls its `/health` endpoint until ready, and exposes a `stop()` for clean shutdown. `src/index.ts` wires this in at startup and stops it on SIGINT/SIGTERM. `src/ai/client.ts`'s `LITELLM_BASE_URL`/`LITELLM_API_KEY` become optional (defaulted for the app's own local proxy); `LITELLM_MODEL` stays required and explicit.

**Tech Stack:** Same as the rest of the project (TypeScript, Node.js, Vitest). No new npm dependencies — uses Node's built-in `node:child_process` and global `fetch`.

## Global Constraints

- `LITELLM_MODEL` remains required and explicit (e.g. `anthropic/claude-sonnet-5`) — no auto-selection of a model, per the design decision to keep provider/model choice unambiguous.
- Only `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` are read for provider credentials — no other env var names.
- The proxy is started by the app itself as a child process — not a separate command the user runs and leaves running.
- If no provider keys are set, the app must still start normally — scraping, resume upload, and the queue view are unaffected; only `/rank` remains unusable until a key + `LITELLM_MODEL` are set (this was already true before this plan and must not regress).
- If the `litellm` binary can't be spawned (not installed), the app must log a clear, actionable error (naming the `pip install` command) and keep running — never crash the whole process over this.
- TypeScript end-to-end. Personal, single-user tool.

## Scope note

This plan revises part of Phase 2 (the original `src/ai/client.ts` from Phase 2 Task 3, and `src/index.ts` from Phase 2 Task 10) rather than starting from scratch. Read the current state of `src/ai/client.ts`, `src/index.ts`, and `README.md` before starting — all three already exist and this plan modifies them.

---

### Task 1: LiteLLM proxy config generator

**Files:**
- Create: `src/ai/proxyConfig.ts`
- Test: `test/ai/proxyConfig.test.ts`

**Interfaces:**
- Produces: `DEFAULT_LITELLM_PROXY_PORT = 4000`; `ProxyConfigResult { yaml: string; providers: string[] }`; `buildProxyConfig(env?: NodeJS.ProcessEnv): ProxyConfigResult | null` — returns `null` when no provider key env vars are set.

- [ ] **Step 1: Write the failing test**

`test/ai/proxyConfig.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildProxyConfig } from "../../src/ai/proxyConfig.js";

describe("buildProxyConfig", () => {
  it("returns null when no provider keys are set", () => {
    expect(buildProxyConfig({})).toBeNull();
  });

  it("includes a wildcard entry for each provider key that's set", () => {
    const result = buildProxyConfig({
      OPENAI_API_KEY: "sk-openai-test",
      ANTHROPIC_API_KEY: "sk-anthropic-test",
    });

    expect(result).not.toBeNull();
    expect(result!.providers.sort()).toEqual(["anthropic", "openai"]);
    expect(result!.yaml).toContain('model_name: "openai/*"');
    expect(result!.yaml).toContain('model: "openai/*"');
    expect(result!.yaml).toContain('api_key: "os.environ/OPENAI_API_KEY"');
    expect(result!.yaml).toContain('model_name: "anthropic/*"');
    expect(result!.yaml).toContain('api_key: "os.environ/ANTHROPIC_API_KEY"');
  });

  it("includes only the gemini entry when only GEMINI_API_KEY is set", () => {
    const result = buildProxyConfig({ GEMINI_API_KEY: "test-key" });
    expect(result!.providers).toEqual(["gemini"]);
    expect(result!.yaml).toContain('model_name: "gemini/*"');
    expect(result!.yaml).not.toContain("openai");
    expect(result!.yaml).not.toContain("anthropic");
  });

  it("ignores unrelated env vars", () => {
    const result = buildProxyConfig({ PATH: "/usr/bin", HOME: "/home/user" });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ai/proxyConfig.test.ts`
Expected: FAIL — `src/ai/proxyConfig.ts` does not exist yet.

- [ ] **Step 3: Implement `src/ai/proxyConfig.ts`**

```typescript
export const DEFAULT_LITELLM_PROXY_PORT = 4000;

export interface ProxyConfigResult {
  yaml: string;
  providers: string[];
}

const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export function buildProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfigResult | null {
  const providers = Object.entries(PROVIDER_ENV_VARS)
    .filter(([, envVar]) => Boolean(env[envVar]))
    .map(([provider]) => provider);

  if (providers.length === 0) {
    return null;
  }

  const entries = providers.map((provider) => {
    const envVar = PROVIDER_ENV_VARS[provider];
    return [
      `  - model_name: "${provider}/*"`,
      `    litellm_params:`,
      `      model: "${provider}/*"`,
      `      api_key: "os.environ/${envVar}"`,
    ].join("\n");
  });

  return {
    yaml: `model_list:\n${entries.join("\n")}\n`,
    providers,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ai/proxyConfig.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai/proxyConfig.ts test/ai/proxyConfig.test.ts
git commit -m "feat: add LiteLLM proxy config generator from provider env vars

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: LiteLLM proxy process manager

**Files:**
- Create: `src/ai/proxyProcess.ts`
- Test: `test/ai/proxyProcess.test.ts`

**Interfaces:**
- Consumes: `buildProxyConfig`, `DEFAULT_LITELLM_PROXY_PORT` (Task 1).
- Produces: `ManagedProxy { stop(): void }`; `StartProxyOptions { configPath: string; port: number; env?: NodeJS.ProcessEnv; readyTimeoutMs?: number; spawnFn?: (command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess; fetchFn?: typeof fetch }`; `startLiteLlmProxy(options: StartProxyOptions): Promise<ManagedProxy | null>` — returns `null` (without spawning anything) when `buildProxyConfig` returns `null`.

- [ ] **Step 1: Write the failing test**

`test/ai/proxyProcess.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLiteLlmProxy } from "../../src/ai/proxyProcess.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("startLiteLlmProxy", () => {
  it("returns null and never spawns when no provider keys are set", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-proxy-test-"));
    const spawnFn = vi.fn();

    const result = await startLiteLlmProxy({
      configPath: join(tmpDir, "config.yaml"),
      port: 4000,
      env: {},
      spawnFn,
    });

    expect(result).toBeNull();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("writes the config file, spawns litellm, waits for health, and returns a stoppable handle", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-proxy-test-"));
    const configPath = join(tmpDir, "config.yaml");
    const fakeChild = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(fakeChild);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });

    const proxy = await startLiteLlmProxy({
      configPath,
      port: 4000,
      env: { ANTHROPIC_API_KEY: "sk-test" },
      spawnFn,
      fetchFn,
    });

    expect(proxy).not.toBeNull();
    expect(spawnFn).toHaveBeenCalledWith(
      "litellm",
      ["--config", configPath, "--port", "4000"],
      expect.objectContaining({ env: { ANTHROPIC_API_KEY: "sk-test" } })
    );
    expect(readFileSync(configPath, "utf-8")).toContain('model_name: "anthropic/*"');
    expect(fetchFn).toHaveBeenCalledWith("http://localhost:4000/health");

    proxy!.stop();
    expect(fakeChild.kill).toHaveBeenCalled();
  });

  it("logs a clear message and resolves without throwing when the litellm binary is missing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "applicationvt-proxy-test-"));
    const fakeChild = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(fakeChild);
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const proxyPromise = startLiteLlmProxy({
      configPath: join(tmpDir, "config.yaml"),
      port: 4000,
      env: { OPENAI_API_KEY: "sk-test" },
      spawnFn,
      fetchFn,
      readyTimeoutMs: 10,
    });

    fakeChild.emit("error", new Error("spawn litellm ENOENT"));
    const proxy = await proxyPromise;

    expect(proxy).not.toBeNull(); // handle still returned; stop() is a safe no-op-ish kill
    expect(errorSpy.mock.calls.some(([msg]) => String(msg).includes("pip install"))).toBe(true);
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ai/proxyProcess.test.ts`
Expected: FAIL — `src/ai/proxyProcess.ts` does not exist yet.

- [ ] **Step 3: Implement `src/ai/proxyProcess.ts`**

```typescript
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildProxyConfig } from "./proxyConfig.js";

export interface ManagedProxy {
  stop(): void;
}

export interface StartProxyOptions {
  configPath: string;
  port: number;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  fetchFn?: typeof fetch;
}

export async function startLiteLlmProxy(
  options: StartProxyOptions
): Promise<ManagedProxy | null> {
  const env = options.env ?? process.env;
  const configResult = buildProxyConfig(env);
  if (!configResult) {
    return null;
  }

  mkdirSync(dirname(options.configPath), { recursive: true });
  writeFileSync(options.configPath, configResult.yaml, "utf-8");

  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn(
    "litellm",
    ["--config", options.configPath, "--port", String(options.port)],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  );

  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[litellm] ${chunk}`));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[litellm] ${chunk}`));
  child.on("error", (err: Error) => {
    console.error(
      `Failed to start LiteLLM proxy: ${err.message}. Install it with: pip install "litellm[proxy]"`
    );
  });

  const fetchFn = options.fetchFn ?? fetch;
  const ready = await waitForHealth(
    `http://localhost:${options.port}/health`,
    options.readyTimeoutMs ?? 30000,
    fetchFn
  );
  if (!ready) {
    console.error(
      "LiteLLM proxy did not become ready in time; /rank will fail until it's reachable."
    );
  }

  return {
    stop() {
      child.kill();
    },
  };
}

async function waitForHealth(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return true;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, timeoutMs)));
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ai/proxyProcess.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai/proxyProcess.ts test/ai/proxyProcess.test.ts
git commit -m "feat: add LiteLLM proxy process manager (spawn, health-check, stop)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Relax AI client env var requirements

**Files:**
- Modify: `src/ai/client.ts`
- Modify: `test/ai/client.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_LITELLM_PROXY_PORT` (Task 1).
- Produces: `createLiteLlmClient(env?: NodeJS.ProcessEnv): AiClient` — now only throws if `LITELLM_MODEL` is missing; `LITELLM_BASE_URL` defaults to `http://localhost:<LITELLM_PROXY_PORT or DEFAULT_LITELLM_PROXY_PORT>`, `LITELLM_API_KEY` defaults to a fixed local placeholder.

Read the current `src/ai/client.ts` and `test/ai/client.test.ts` before starting — this task modifies both, replacing the existing "all three env vars required" behavior.

- [ ] **Step 1: Update the test file** (full file)

`test/ai/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createLiteLlmClient } from "../../src/ai/client.js";

describe("createLiteLlmClient", () => {
  it("throws when LITELLM_MODEL is missing", () => {
    expect(() => createLiteLlmClient({})).toThrow(
      "LITELLM_MODEL must be set to use AI features (e.g. anthropic/claude-sonnet-5)."
    );
  });

  it("returns a client when only LITELLM_MODEL is set, defaulting base URL and api key", () => {
    const client = createLiteLlmClient({ LITELLM_MODEL: "anthropic/claude-sonnet-5" });
    expect(typeof client.complete).toBe("function");
  });

  it("returns a client when all env vars are explicitly set", () => {
    const client = createLiteLlmClient({
      LITELLM_BASE_URL: "http://localhost:4000",
      LITELLM_API_KEY: "test-key",
      LITELLM_MODEL: "claude-sonnet-5",
    });
    expect(typeof client.complete).toBe("function");
  });

  it("respects LITELLM_PROXY_PORT when defaulting the base URL", () => {
    // No direct way to inspect the constructed OpenAI client's baseURL from here;
    // this test just confirms construction doesn't throw with a custom port set,
    // covering the code path that reads LITELLM_PROXY_PORT.
    const client = createLiteLlmClient({
      LITELLM_MODEL: "openai/gpt-4o-mini",
      LITELLM_PROXY_PORT: "5000",
    });
    expect(typeof client.complete).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ai/client.test.ts`
Expected: FAIL — current implementation still requires `LITELLM_BASE_URL`/`LITELLM_API_KEY` and throws a different message.

- [ ] **Step 3: Update `src/ai/client.ts`** (full file)

```typescript
import OpenAI from "openai";
import { DEFAULT_LITELLM_PROXY_PORT } from "./proxyConfig.js";

export interface AiClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export function createLiteLlmClient(env: NodeJS.ProcessEnv = process.env): AiClient {
  const model = env.LITELLM_MODEL;
  if (!model) {
    throw new Error(
      "LITELLM_MODEL must be set to use AI features (e.g. anthropic/claude-sonnet-5)."
    );
  }

  const port = env.LITELLM_PROXY_PORT ?? String(DEFAULT_LITELLM_PROXY_PORT);
  const baseURL = env.LITELLM_BASE_URL ?? `http://localhost:${port}`;
  const apiKey = env.LITELLM_API_KEY ?? "local-dev-key";

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ai/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: all tests, including `test/ai/rank.test.ts` and `test/rankAll.test.ts` (which depend on `AiClient`'s shape, unchanged here), still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ai/client.ts test/ai/client.test.ts
git commit -m "feat: default LITELLM_BASE_URL/LITELLM_API_KEY for the self-managed proxy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire auto-start into the app + update README

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `startLiteLlmProxy`, `DEFAULT_LITELLM_PROXY_PORT` (Tasks 1-2).
- Produces: the fully wired application, starting/stopping the LiteLLM proxy automatically.

This is a composition-root change, verified by type-checking, the full test suite, and manual verification rather than a new unit test — consistent with how `/scrape` and `/rank` wiring were verified in earlier tasks.

- [ ] **Step 1: Update `src/index.ts`** (full file)

Read the current file first — this replaces it entirely, adding the proxy lifecycle around the existing server/cron setup.

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
import { startLiteLlmProxy, type ManagedProxy } from "./ai/proxyProcess.js";
import { DEFAULT_LITELLM_PROXY_PORT } from "./ai/proxyConfig.js";
import { getResume } from "./db/resume.js";
import { createServer } from "./server.js";

const DB_PATH = process.env.DB_PATH ?? "data/applicationvt.sqlite3";
const COMPANIES_PATH = process.env.COMPANIES_PATH ?? "config/companies.json";
const FILTERS_PATH = process.env.FILTERS_PATH ?? "config/filters.json";
const PORT = Number(process.env.PORT ?? 3000);
const SCRAPE_CRON = process.env.SCRAPE_CRON ?? "0 6 * * *"; // daily at 06:00
const LITELLM_PROXY_PORT = Number(process.env.LITELLM_PROXY_PORT ?? DEFAULT_LITELLM_PROXY_PORT);
const LITELLM_CONFIG_PATH = process.env.LITELLM_CONFIG_PATH ?? "data/litellm-config.generated.yaml";

async function main(): Promise<void> {
  if (DB_PATH !== ":memory:") {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }
  const db = createDb(DB_PATH);
  const companies = loadCompanyConfig(COMPANIES_PATH);

  let liteLlmProxy: ManagedProxy | null = null;
  try {
    liteLlmProxy = await startLiteLlmProxy({
      configPath: LITELLM_CONFIG_PATH,
      port: LITELLM_PROXY_PORT,
    });
    if (liteLlmProxy) {
      console.log(`LiteLLM proxy running on http://localhost:${LITELLM_PROXY_PORT}`);
    } else {
      console.log(
        "No provider API keys set (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) — /rank will be unavailable until one is set."
      );
    }
  } catch (err) {
    console.error(
      `Could not start LiteLLM proxy: ${err instanceof Error ? err.message : String(err)}`
    );
  }

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

  const server = app.listen(PORT, () => {
    console.log(`applicationVT listening on http://localhost:${PORT}`);
    console.log(`View discovered postings at http://localhost:${PORT}/postings`);
    console.log(`View ranked queue at http://localhost:${PORT}/queue`);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;

  cron.schedule(SCRAPE_CRON, () => {
    console.log("Running scheduled scrape...");
    scrapeAll(db, companies).then((results) => {
      console.log("Scrape complete:", results);
    });
  });

  const shutdown = () => {
    liteLlmProxy?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Update `README.md`** (full file)

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
3. One-time only: install LiteLLM, which the app uses to talk to whichever
   AI provider(s) you want to test with:
   ```bash
   pip install "litellm[proxy]"
   ```
4. Set the API key(s) for whichever provider(s) you want to test — any
   subset of these:
   ```bash
   export OPENAI_API_KEY=sk-...
   export ANTHROPIC_API_KEY=sk-ant-...
   export GEMINI_API_KEY=...
   ```
5. Pick which model to actually use for ranking (must be under a provider
   whose key you set above):
   ```bash
   export LITELLM_MODEL=anthropic/claude-sonnet-5
   ```
   To test a different provider, just change this one value and restart.
6. Run the app: `npm run dev`

   This automatically generates a LiteLLM proxy config from whichever keys
   you set in step 4 and starts the proxy in the background — nothing else
   to run or configure. If no keys are set, the app still starts normally;
   only `/rank` is unavailable until you set at least one.

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
  (ranking is sequential — one AI call per posting — so a large batch can
  take a while; that's expected, not a hang)
- View the ranked queue, sorted by relevance: http://localhost:3000/queue

A scrape also runs automatically every day at 06:00 (server time). Override
the schedule with the `SCRAPE_CRON` environment variable (cron syntax).

## Testing

`npm test`
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full automated test suite**

Run: `npm test`
Expected: all tests from this plan and all earlier Phase 1/2 tasks PASS.

- [ ] **Step 5: Manually verify graceful behavior with no provider keys set**

Run (in an environment/shell with none of `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` set):
```bash
npm run dev
```
Expected console output includes: `No provider API keys set (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) — /rank will be unavailable until one is set.` and the app still starts and listens normally (no crash).

In a separate terminal:
```bash
curl http://localhost:3000/postings
curl -X POST http://localhost:3000/rank
```
Expected: `GET /postings` returns 200 normally; `POST /rank` returns its existing "no resume" or "LITELLM_MODEL must be set" error (whichever applies), not a crash or hang.

Stop the dev server (Ctrl+C) and confirm the process exits cleanly.

- [ ] **Step 6: Manually verify graceful degradation when `litellm` isn't installed**

If `litellm` is not installed in this environment (check with `litellm --version`; if it happens to be installed, skip this step and note that in your report), run with one provider key set:
```bash
OPENAI_API_KEY=sk-fake-test-key npm run dev
```
Expected: a console error naming `pip install "litellm[proxy]"`, and the app still starts and listens (verify with `curl http://localhost:3000/postings` returning 200). Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: auto-start LiteLLM proxy from provider env vars on app boot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
