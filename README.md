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
