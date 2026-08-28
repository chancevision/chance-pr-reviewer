# High-Signal PR Review Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scorecard-style PR reviews with sparse inline-first feedback, code-derived verdicts, draft/bot gating, and light context (rules / CODEOWNERS / import-related files).

**Architecture:** Keep the existing Hono webhook → fetch → LLM → post-review pipeline. Slim the Zod schema and prompt; add pure helpers for diff-line validation, CODEOWNERS/import parsing, and verdict derivation; extend `fetchPRData` to pack extra context; gate webhooks and dismiss superseded change requests.

**Tech Stack:** TypeScript (ESM), Zod, Octokit, OpenAI-compatible SDK — no new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-28-high-signal-review-design.md](../specs/2026-08-28-high-signal-review-design.md)

## Global Constraints

- No default exports; named exports only
- No new npm dependencies
- Verdict is derived in code — LLM must not emit merge event fields
- Never `@`-mention guessed users; CODEOWNERS shown as plain text only
- Inline comments: max 8 total, max 3 suggestions; must be valid diff right-hand lines
- Skip draft PRs and bot authors
- `npm run typecheck` must pass

## File map

| File | Responsibility |
|------|----------------|
| `src/review-schema.ts` | Slim Zod schema |
| `src/prompt.ts` | High-signal system/user prompts |
| `src/format-review.ts` | Slim markdown + inline formatting |
| `src/diff-lines.ts` | Parse unified diff → commentable `(file, line)` set |
| `src/context-extras.ts` | CODEOWNERS parse, import path extract, path resolve |
| `src/filter-review.ts` | Cap/filter inline comments; derive GitHub event + status text |
| `src/fetch-pr.ts` | Fetch rules, CODEOWNERS, related files, omission notes |
| `src/llm.ts` | Pass expanded PRData into `buildMessages` |
| `src/post-review.ts` | Filter → verdict → dismiss old → post (body-only fallback) |
| `src/webhook.ts` | Draft/bot skip |
| `AGENTS.md` | Document new behavior |

---

### Task 1: Slim schema + prompt + formatter

- [ ] Rewrite `src/review-schema.ts` to the approved slim shape (`summary`, `security`, `findings`, `inlineComments`, `confidence`)
- [ ] Rewrite `src/prompt.ts` system prompt for high-signal rules; extend `buildUserMessage` to accept rules, codeowners, related files, contextNotes
- [ ] Rewrite `src/format-review.ts` for short body + optional details (owners, omissions)
- [ ] Commit

### Task 2: Pure helpers

- [ ] Add `src/diff-lines.ts` — `buildCommentableLines(diff): Map<string, Set<number>>`
- [ ] Add `src/context-extras.ts` — `parseCodeowners`, `matchCodeowners`, `extractImportPaths`
- [ ] Add `src/filter-review.ts` — `filterInlineComments`, `deriveReviewDecision`
- [ ] Commit

### Task 3: Fetch context pack + LLM wiring

- [ ] Extend `PRData` and `fetchPRData` for rulesFiles, relatedContexts, codeownersMatches, contextNotes
- [ ] Update `callLLM` / webhook to pass full `PRData`
- [ ] Commit

### Task 4: Post-review + webhook gates

- [ ] `webhook.ts`: skip draft / bot
- [ ] `post-review.ts`: filter comments, derive verdict, dismiss superseded `CHANGES_REQUESTED`, body-only fallback on createReview failure
- [ ] Commit

### Task 5: Docs + verify

- [ ] Update `AGENTS.md` (architecture, dimensions table → new flow, merge blocking table)
- [ ] `npm run typecheck`
- [ ] Push + open PR

## Done when

1. Typecheck clean
2. Review body is short; no score pills / acceptanceCriteria / guessed @mentions
3. Verdicts come from `deriveReviewDecision`, not LLM
4. Draft/bot PRs are skipped
5. Docs match runtime
