import { describe, it, expect } from "vitest";
import { createLiteLlmClient } from "../../src/ai/client.js";

describe("createLiteLlmClient", () => {
  it("throws when required env vars are missing", () => {
    expect(() => createLiteLlmClient({})).toThrow(
      "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL must all be set to use AI features."
    );
  });

  it("throws when only some env vars are set", () => {
    expect(() => createLiteLlmClient({ LITELLM_BASE_URL: "http://localhost:4000" })).toThrow(
      /must all be set/
    );
  });

  it("returns a client when all env vars are set", () => {
    const client = createLiteLlmClient({
      LITELLM_BASE_URL: "http://localhost:4000",
      LITELLM_API_KEY: "test-key",
      LITELLM_MODEL: "claude-sonnet-5",
    });
    expect(typeof client.complete).toBe("function");
  });
});
