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
