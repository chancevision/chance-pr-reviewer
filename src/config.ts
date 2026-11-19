import { z } from "zod";

const envSchema = z.object({
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().default("deepseek/deepseek-v4-pro"),
  GITHUB_APP_ID: z.string().transform((v) => Number(v)),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1, "GITHUB_APP_PRIVATE_KEY is required"),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, "GITHUB_WEBHOOK_SECRET is required"),
  LLM_ENABLE_THINKING: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  // Shared by reasoning and the review text. Must not exceed the model's
  // maximum output (DeepSeek: 393216).
  LLM_MAX_OUTPUT_TOKENS: z
    .string()
    .regex(/^[1-9]\d*$/, "LLM_MAX_OUTPUT_TOKENS must be a positive integer")
    .transform((v) => Number(v))
    .default("131072"),
  PORT: z
    .string()
    .transform((v) => Number(v))
    .default("3000"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
