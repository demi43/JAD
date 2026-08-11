import OpenAI from "openai";

export interface AiClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export function createLiteLlmClient(env: NodeJS.ProcessEnv = process.env): AiClient {
  const baseURL = env.LITELLM_BASE_URL;
  const apiKey = env.LITELLM_API_KEY;
  const model = env.LITELLM_MODEL;

  if (!baseURL || !apiKey || !model) {
    throw new Error(
      "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL must all be set to use AI features."
    );
  }

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
