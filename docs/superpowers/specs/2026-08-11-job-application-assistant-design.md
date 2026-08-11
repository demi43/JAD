# Job Application Assistant — Design Spec

Date: 2026-08-11
Status: Approved (pending spec review)

## Summary

A personal, self-hosted tool that finds relevant job postings (from a
growing list of target companies' own career pages, plus job boards),
filters and ranks them against the user's resume, drafts tailored resume
content and answers to each posting's custom questions with AI, and — once
the user reviews and approves a draft — auto-fills the real application
form in the user's own browser so they can review and click Submit
themselves.

This is a single-user tool (the user is the only account), not a
multi-tenant SaaS product.

## Goals

- Catch postings as early as possible by scraping companies' own career
  pages directly (companies post there before job boards), for a
  user-curated, growing list of target companies.
- Also pull postings from job board sources for broader coverage.
- Cut down manual effort of tailoring resume content and writing answers
  to repetitive application questions, while keeping the user in control
  of what actually gets submitted.
- Avoid getting blocked/flagged by sites during the apply step by doing
  the actual form-fill inside the user's real, already-authenticated
  browser session rather than an automated headless browser impersonating
  them.
- Track application status over time (queued → applied → outcome).

## Non-goals

- Fully autonomous applying with no human review — every application is
  reviewed (content and final submit) by the user before it goes out.
- Multi-user accounts, billing, or any SaaS concerns.
- Scraping/automating sites in ways that require bypassing login walls or
  CAPTCHAs from the server side — login-gated sites are handled via the
  browser extension in the user's real session instead.

## Architecture

Two cooperating pieces sharing one backend API and database:

- **Web app** (backend + frontend, self-hosted): owns resume/profile
  data, the tracked-company and job-board source config, the scraping
  schedule, AI-based filtering/ranking/drafting, and the review queue UI.
- **Browser extension** (Chrome): runs in the user's real, logged-in
  browser. When the user opens a queued application's URL (or triggers it
  from the review queue), it pulls the approved content package from the
  backend and fills the real form's fields — resume upload, text answers,
  dropdowns — then stops before the Submit button. The user reviews the
  filled page and clicks Submit themselves.

Rationale for splitting apply-automation into an extension rather than
doing it server-side: many ATS platforms require login and actively
detect/block automated (headless) browsers. Filling the form inside the
user's real browser session sidesteps both problems, since it genuinely
is the user, with their cookies, doing the filling.

## Components

1. **Profile/Resume Manager** — structured resume (work history, skills,
   education) that is the single source of truth for AI-generated
   content, plus stored resume documents/versions.
2. **Company & Source Config** — the user's tracked-company list (career
   page URL + detected ATS platform: Greenhouse/Lever/Workday/Ashby/etc.),
   designed so adding a new company is a config entry, not new code, plus
   job board API configs. Starts as a fixed list, expected to grow over
   time.
3. **Scraper Engine** — one scraper per ATS template (not per company),
   since most company career pages are hosted on a handful of ATS
   platforms with consistent structure, plus job board API clients.
   Normalizes all postings into a common schema and dedupes.
4. **Filter & Ranking Engine** — rule-based filters (title/keyword/
   location/seniority, exclude-keywords) run first to cut volume; AI then
   relevance-scores and ranks the remaining postings against the user's
   resume.
5. **Draft Generator** — for each posting that clears filtering, calls the
   AI (Claude API) with the resume + job description to draft tailored
   resume highlights and answers to the posting's custom questions.
6. **Review Queue (web UI)** — lists candidate applications with their AI
   drafts; user edits/approves content here. Approving marks an
   application "ready to apply."
7. **Browser Extension** — on an approved application's page, fetches the
   approved content package via the backend API and fills the real form;
   flags any field it can't confidently map for manual entry instead of
   guessing; reports the outcome (applied/skipped) back to the backend.
8. **Application Tracker** — status pipeline per posting (discovered →
   queued → drafted → approved → applied), with a place for the user to
   log outcomes (interview/rejected/offer/etc.) as they hear back.

## Data flow

```
[Scheduled scrape] -> scraper hits each configured company career page
    (via its ATS template) and job board APIs -> normalizes into a common
    posting schema -> dedupes against existing postings (same company +
    title + location; direct-from-company kept as canonical over a job
    board duplicate) -> stored as "discovered"

[Filtering] -> rule filters (title/keyword/location) run first -> AI
    relevance-scores surviving postings against the resume -> ranked
    postings enter the review queue as "queued"

[Drafting] -> AI drafts tailored resume highlights + answers to each
    queued posting's custom questions, using resume + job description ->
    status becomes "drafted"

[Review] -> user opens a drafted application, edits/approves AI content
    -> status becomes "approved"

[Apply] -> user opens the posting's URL; extension detects an approved
    package for that URL and fills the real form -> user reviews and
    clicks Submit themselves -> extension reports back -> status becomes
    "applied"

[Tracking] -> user manually updates status later as they hear back
```

## Error handling

- **Scraper breaks** (a company changes their career page, or an ATS
  tweaks its template): that source fails and is logged/surfaced in the
  UI as stale/broken; it does not block the rest of the scrape run.
- **AI drafting fails or times out**: retry with backoff; on continued
  failure the posting still enters the queue with blank draft fields for
  the user to fill manually, rather than being dropped.
- **Extension can't map a field** (unusual widget, file upload quirks,
  etc.): fills what it can and visibly flags unmapped fields rather than
  failing the whole autofill or guessing.
- **Duplicate postings**: deduped by normalized signature (company +
  title + location); the direct-from-company posting is kept as canonical
  when both exist.

## Testing approach

- **Scrapers**: unit tests per ATS template against saved sample HTML
  fixtures, not live sites. A live scrape failure is a signal to capture
  a fresh fixture and update the parser, not a test-suite gap.
- **Filter/ranking logic**: standard deterministic unit tests.
- **Draft generation**: golden-shape tests (given a fixed resume +
  posting, confirm the pipeline produces reasonably structured output)
  rather than asserting exact AI text.
- **Extension fill behavior**: manual smoke testing against real target
  sites as sources are added; third-party DOM structures are out of our
  control, so heavy automated e2e here isn't worth the fragility.

## Tech stack

TypeScript across the whole project:

- **Backend**: Node.js + TypeScript (API server, scheduler, scraper
  engine, AI drafting calls).
- **Scraping/automation**: Playwright (TypeScript bindings) for the
  per-ATS-template scrapers.
- **Frontend**: React + TypeScript (review queue UI).
- **Browser extension**: TypeScript, Manifest V3 (required — Chrome
  extensions must be JS/TS regardless of backend choice).
- **AI**: LiteLLM (self-hosted proxy, OpenAI-compatible interface),
  called from the backend via the `openai` TypeScript SDK pointed at the
  proxy's base URL. LiteLLM lists provider API keys (Anthropic, OpenAI,
  etc.) under model aliases in its own config, so the app can be pointed
  at different providers/models for testing without app code changes.
  See the Phase 2 addendum below for the resulting client shape.

Rationale: this is a solo-maintained personal tool where the same person
debugs the scraper, API, UI, and extension in one sitting. One language
end-to-end means one set of shared type definitions for the posting
schema and the "approved content package" used by the backend, frontend,
and extension alike, rather than keeping a Python schema and a TS schema
in sync by hand.

## Key decisions log

- Personal, single-user tool (not multi-tenant SaaS).
- Review-before-submit on both content (AI drafts, user edits/approves)
  and the final action (user clicks Submit, not the tool).
- Company career pages are the primary source (earlier signal than job
  boards); job boards supplement for coverage.
- Company list starts fixed, grows over time via config, not code
  changes.
- Self-hosted web app (frontend + backend + DB), not a local-only
  script — accessible from any device on the user's network.
- AI drafts every custom-question answer by default; user reviews/edits
  each one rather than starting from a blank field.
- Apply-time automation happens via a browser extension in the user's
  real browser session, not a server-side headless browser, specifically
  to avoid login walls and bot-detection on ATS platforms.
- TypeScript end-to-end (backend, frontend, extension) for one shared
  type system across the whole project, given a solo maintainer.

## Phase 2 addendum — Resume + Filtering + Ranking

Added 2026-08-11, after Phase 1 (Discovery) shipped. Phase 1 deliberately
left out the Profile/Resume Manager (see the Phase 1 plan's scope note);
this addendum specifies it now that ranking is the thing that consumes it.

**Resume storage**: single-user tool, so there is exactly one active
resume at a time — a new upload replaces the previous one, no versioning.
Uploaded as PDF or DOCX via `POST /resume` (multipart), text is extracted
deterministically (`pdf-parse` for PDF, `mammoth` for DOCX — no AI call
at upload time) and stored alongside the original file bytes in SQLite.
Full structuring into work history/skills/education is explicitly
deferred to Phase 3, since nothing before drafting consumes structured
fields — ranking only needs resume text to compare against a job
description.

**Rule filters**: title-only include/exclude keyword matching for this
phase, configured in `config/filters.json` (same load/validate pattern as
`config/companies.json`). Location and seniority filtering are explicitly
out of scope for now.

**AI ranking**: for postings that pass the title filter and don't yet
have a score, call the AI client with resume text + job description;
response is `{ score: 0-100, reason: string }`. Both are stored per
posting so the queue view can sort by score and show the reason inline
for a sanity check on the AI's judgment.

**AI client**: a single `src/ai/client.ts` wraps a self-hosted LiteLLM
proxy via the OpenAI-compatible `openai` npm SDK
(`LITELLM_BASE_URL` / `LITELLM_API_KEY` / `LITELLM_MODEL` env vars).
Requires `pip install 'litellm[proxy]'` and a `config.yaml` listing
provider keys under model aliases, run separately from this app. Every
AI-consuming module (ranking now, drafting in Phase 3) goes through this
one client, so swapping models/providers for testing is a proxy-config
change, not an app-code change.

**Queue view**: extends the Phase 1 postings view with a ranked/filtered
listing, sorted by score, showing each posting's reason — same
plain-HTML-no-framework approach as Phase 1 (a real frontend is still
Phase 3's concern, once review/edit interactions actually need one).

## Open items for later phases (explicitly out of scope for v1)

- Cover letter generation (mentioned as a possible extra during design;
  not required for v1, can be added to the Draft Generator later).
- Notifications (email/Slack) when new high-ranked postings appear.
- Which specific job board APIs to integrate first (to be chosen when
  the source config is built out, based on the user's actual target
  companies/industries).
- Location and seniority rule filters (Phase 2 ships title-only
  filtering; add these if title keywords alone prove too coarse).
- Structured resume fields (work history/skills/education) — deferred to
  Phase 3, when the Draft Generator first needs them.
