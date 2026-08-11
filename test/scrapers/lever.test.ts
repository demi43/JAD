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
