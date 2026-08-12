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
  (ranking is sequential — one AI call per posting — so a large batch of
  postings can take a while; that's expected, not a hang)
- View the ranked queue, sorted by relevance: http://localhost:3000/queue

A scrape also runs automatically every day at 06:00 (server time). Override
the schedule with the `SCRAPE_CRON` environment variable (cron syntax).

## Testing

`npm test`
