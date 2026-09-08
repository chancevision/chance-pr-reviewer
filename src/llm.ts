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

const MAX_OUTPUT_TOKENS = 32768;

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
    linkedIssues: prData.linkedIssues,
    contextNotes: prData.contextNotes,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params: Record<string, unknown> = {
        model: env.LLM_MODEL,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
      };

      if (env.LLM_ENABLE_THINKING) {
        params.reasoning_effort = "high";
        params.thinking = { type: "enabled" };
      } else {
        params.temperature = 0.3;
        params.thinking = { type: "disabled" };
      }

      const completion = await client.chat.completions.create(params as any);
      const choice = completion.choices[0];
      const message = choice?.message as
        | { content?: string | null; reasoning_content?: string }
        | undefined;

      if (choice?.finish_reason === "length") {
        const reasoningTokens =
          (completion.usage as { completion_tokens_details?: { reasoning_tokens?: number } })
            ?.completion_tokens_details?.reasoning_tokens ?? "unknown";
        throw new Error(
          `LLM output truncated (finish_reason=length, reasoning_tokens=${reasoningTokens})`,
        );
      }

      const raw = message?.content;
      if (!raw) {
        const reasoningLen = message?.reasoning_content?.length ?? 0;
        throw new Error(
          `Empty response from LLM (finish_reason=${choice?.finish_reason}, reasoning_chars=${reasoningLen})`,
        );
      }

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
          `LLM call failed (attempt ${attempt + 1}/3): ${detail}`,
        );
      }
    }
  }

  throw new Error(
    `Failed to get valid review after 3 attempts: ${String(lastError)}`,
  );
}
