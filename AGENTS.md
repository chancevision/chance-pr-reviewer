# AGENTS.md

## Project

`chance-pr-reviewer` — AI-powered GitHub PR review bot by Chance AI. Listens for PR webhook events (opened, synchronize, reopened), sends the diff (plus light repo context) to an LLM via an OpenAI-compatible API, and posts a sparse, inline-first review. Merge-blocking decisions are derived in code from findings — not from free-form LLM score labels.

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
  → src/index.ts           Hono HTTP server, verifies webhook signature
  → src/webhook.ts         Routes pull_request events; skips drafts/bots
  → src/github-app.ts      JWT auth → installation token → Octokit client
  → src/status.ts          Sets commit status (pending → success/failure)
  → src/fetch-pr.ts        Diff, changed files, rules, CODEOWNERS, related imports, linked issues
  → src/context-extras.ts  CODEOWNERS + import path helpers
  → src/prompt.ts          Builds system + user messages for LLM
  → src/llm.ts             OpenAI-compatible API call; JSON parse + retry
  → src/review-schema.ts   Zod schema for the slim LLM response
  → src/diff-lines.ts      Commentable (file, line) set from unified diff
  → src/filter-review.ts   Caps/filters inline comments; derives review event
  → src/format-review.ts   Short markdown body + inline comment text
  → src/post-review.ts     Placeholder, dismiss superseded, post review
```

## Review Flow

1. Webhook received → skip if draft or bot author
2. Set commit status to `pending`, post "AI review in progress..." comment
3. Fetch PR diff + changed-file contents + rules / CODEOWNERS / import-related files / linked issues
4. LLM returns slim JSON (`summary`, `security`, `findings`, `inlineComments`, `confidence`)
5. Validate inline comments against the diff; cap to 8 (max 3 suggestions)
6. Derive GitHub review event + commit status in code
7. Dismiss prior Chance `CHANGES_REQUESTED` reviews; post new review
8. On error: update placeholder comment with error message

## What the LLM Returns

| Field | Role |
|-------|------|
| `summary` | 2–3 sentence overview |
| `security` | `cleared` / `flagged` + one-sentence detail |
| `inlineComments` | Line-anchored feedback (preferred) |
| `findings` | Issues that cannot be anchored to a diff line |
| `confidence` | `high` / `medium` / `low` — low never blocks merge |

Reviews are **inline-first**. No dimension scorecards, guessed test commands, or guessed `@`-mentions.

## Context Pack

In addition to the diff and changed-file contents (capped), the bot may include:

- Rules files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*` (size-capped)
- `CODEOWNERS` (matched owners shown as plain text in optional details — not auto-pinged)
- Up to 10 import-related files not in the diff
- Linked issues referenced in the PR body (`#123`, `Closes #123`), capped at 3 with truncated bodies — used as the spec source for requirement checks
- Omission notes when files are skipped for size/budget

## Merge Blocking

The LLM does **not** choose the GitHub review event. Code derives it:

| Condition | Review Event | Commit Status |
|-----------|--------------|---------------|
| `confidence === "low"` | `COMMENT` | success |
| Critical finding/inline **or** security flagged | `REQUEST_CHANGES` | failure |
| Only warnings/suggestions | `COMMENT` | success |
| No findings, security cleared | `APPROVE` | success |

Status descriptions are short labels such as `clean`, `2 warnings`, or `security flagged` — not a fake `X.X/5` score.

## GitHub App Permissions

Required permissions for the GitHub App:

| Permission | Level | Used For |
|-----------|-------|----------|
| Pull requests | Read & Write | Fetching PR data, posting/dismissing reviews |
| Contents | Read | Fetching PR diffs, rules, CODEOWNERS, related files |
| Commit statuses | Read & Write | Setting pending/success/failure status checks (optional — falls back gracefully if missing) |
| Issues | Read | Fetching linked issues as spec context (optional — skipped with a context note if missing) |

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
