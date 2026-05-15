# AGENTS.md

## Project

`chance-pr-reviewer` — AI-powered GitHub PR review bot by Chance AI. Listens for PR webhook events (opened, synchronize, reopened), sends the diff to an LLM via OpenAI-compatible API, and posts a structured review with a 5-point safety score.

Open source under the MIT license.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server with hot-reload (tsx)
npm run build        # Compile TypeScript → dist/
npm run start        # Run compiled output
npm run typecheck    # Type-check without emitting
```

## Architecture

```
GitHub Webhook (PR event)
  → src/index.ts          Hono HTTP server, verifies webhook signature
  → src/webhook.ts        Routes pull_request events, orchestrates flow
  → src/github-app.ts     JWT auth → installation token → Octokit client
  → src/status.ts         Sets commit status (pending → success/failure)
  → src/fetch-pr.ts       Fetches PR metadata, file list, unified diff
  → src/prompt.ts         Builds system + user messages for LLM
  → src/llm.ts            Calls OpenAI-compatible API (OpenRouter/DeepSeek/etc.), parses JSON, retries on failure
  → src/review-schema.ts  Zod schema for the structured LLM response
  → src/format-review.ts  Converts LLM JSON → GitHub Review markdown + inline comments
  → src/post-review.ts    Orchestrates review flow: placeholder comment, commit status, review posting
```

## Review Flow

1. Webhook received → immediate: set commit status to `pending`, post "AI review in progress..." comment
2. Fetch PR diff + metadata → send to LLM
3. LLM returns structured JSON (see review dimensions below)
4. On success: delete placeholder comment, set commit status to `success`/`failure`, post GitHub Review
5. On error: update placeholder comment with error message

## Review Dimensions

The LLM evaluates every PR across 6 checks:

| Step | Field | What It Checks |
|------|-------|----------------|
| 1 | `reproducibility` | Can the issue/change be confirmed from source inspection? |
| 2 | `behaviorProof` | Does the PR include screenshots, logs, or test evidence? |
| 3 | `securityVerdict` | Standalone security assessment: deps, secrets, auth, injection, paths |
| 4 | `dimensions` | 5-point scoring: codeQuality, security, performance, testing, consistency |
| 5 | `acceptanceCriteria` | Exact test commands to verify the change |
| 6 | `relatedContributors` | GitHub usernames inferred from file paths |

## Merge Blocking

Verdicts map to GitHub Review events:

| Verdict | Score | Review Event | Merge Button |
|---------|-------|-------------|--------------|
| VERY_SAFE | ≥4.5 | `APPROVE` | Unblocked |
| SAFE | ≥3.5 | `COMMENT` | Unblocked |
| CAUTION | ≥2.5 | `REQUEST_CHANGES` | Blocked |
| RISKY | <2.5 | `REQUEST_CHANGES` | Blocked |

## GitHub App Permissions

Required permissions for the GitHub App:

| Permission | Level | Used For |
|-----------|-------|----------|
| Pull requests | Read & Write | Fetching PR data, posting reviews |
| Contents | Read | Fetching PR diffs |
| Commit statuses | Read & Write | Setting pending/success/failure status checks (optional — falls back gracefully if missing) |

Subscribe to: **Pull request** events.

Note: `Contents: Read` must be enabled for `Commit statuses: Read & Write` to be valid. If you change permissions, re-accept them on the Install App page.

- `LLM_ENABLE_THINKING` — Enable reasoning/chain-of-thought mode (default: `false`)

## Configuration

All config via environment variables (see `.env.example`):
- `LLM_BASE_URL` — OpenAI-compatible API base URL (default: OpenRouter)
- `LLM_API_KEY` — API key for the LLM provider
- `LLM_MODEL` — Model name (default: `deepseek/deepseek-v4-pro`)
- `GITHUB_APP_ID` — GitHub App ID
- `GITHUB_APP_PRIVATE_KEY` — GitHub App private key (PEM, `\n` escaped)
- `GITHUB_WEBHOOK_SECRET` — Webhook secret for signature verification
- `PORT` — HTTP server port (default: 3000)

## Key Dependencies

- `openai` — OpenAI SDK, used with custom `baseURL` for provider-agnostic LLM calls
- `@octokit/webhooks` — Webhook signature verification and event parsing
- `@octokit/auth-app` — GitHub App JWT + installation token generation
- `@octokit/rest` — GitHub REST API client
- `hono` + `@hono/node-server` — Lightweight HTTP server
- `zod` — Runtime validation for env vars and LLM response

## Code Conventions

- TypeScript strict mode
- ES modules (`"type": "module"`)
- No default exports; use named exports
- Zod for all external boundary validation
- TypeScript types inferred from Zod schemas where possible
