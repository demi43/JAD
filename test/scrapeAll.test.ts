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
