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
