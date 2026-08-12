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
