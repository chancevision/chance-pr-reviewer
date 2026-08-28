import OpenAI from "openai";
import { reviewSchema, type ReviewResult } from "./review-schema.js";
import { buildMessages } from "./prompt.js";
import type { Env } from "./config.js";
import type { PRData } from "./fetch-pr.js";

export function createLLMClient(env: Env): OpenAI {
  const headers: Record<string, string> = {
    "HTTP-Referer": "https://github.com/chancevision/chance-pr-reviewer",
    "X-OpenRouter-Title": "Chance PR Reviewer",
  };

  return new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    defaultHeaders: headers,
  });
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const objMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1].trim();
  return trimmed;
}

export async function callLLM(
  client: OpenAI,
  env: Env,
  prData: PRData,
): Promise<ReviewResult> {
  const messages = buildMessages({
    title: prData.title,
    body: prData.body,
    files: prData.files,
    diff: prData.diff,
    fileContexts: prData.fileContexts,
    relatedContexts: prData.relatedContexts,
    rulesFiles: prData.rulesFiles,
    codeownersText: prData.codeownersText,
    codeownersMatches: prData.codeownersMatches,
    contextNotes: prData.contextNotes,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params: Record<string, unknown> = {
        model: env.LLM_MODEL,
        messages,
        max_tokens: 8192,
      };

      if (env.LLM_ENABLE_THINKING) {
        params.reasoning_effort = "high";
      } else {
        params.temperature = 0.3;
      }

      const completion = await client.chat.completions.create(params as any);

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from LLM");

      const json = extractJson(raw);
      const parsed = JSON.parse(json);
      const result = reviewSchema.parse(parsed);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        const detail =
          err instanceof SyntaxError
            ? err.message
            : err instanceof Error && "issues" in (err as any)
              ? (err as any).issues
                  ?.map((i: any) => i.path.join(".") + ": " + i.message)
                  .join(", ")
              : String(err);
        console.warn(
          `LLM response parse failed (attempt ${attempt + 1}/3): ${detail}`,
        );
      }
    }
  }

  throw new Error(
    `Failed to get valid review after 3 attempts: ${String(lastError)}`,
  );
}
