# AGENTS.md

## Project

`agent-pr-review` — AI-powered GitHub PR review bot. Listens for PR webhook events (opened, synchronize, reopened), sends the diff to an LLM via OpenAI-compatible API, and posts a structured review with a 5-point safety score.

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
  → src/fetch-pr.ts       Fetches PR metadata, file list, unified diff
  → src/prompt.ts         Builds system + user messages for LLM
  → src/llm.ts            Calls OpenAI-compatible API (OpenRouter/DeepSeek/etc.), parses JSON, retries on failure
  → src/review-schema.ts  Zod schema for the structured LLM response
  → src/format-review.ts  Converts LLM JSON → GitHub Review markdown + inline comments
  → src/post-review.ts    POSTs the review to GitHub via Octokit
```

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
