# High-Signal PR Review (A + B) Design

**Date:** 2026-08-28  
**Status:** Approved for implementation planning  
**Goal:** Make Chance PR Reviewer comments worth reading — sparse, accurate, context-aware — without building Greptile-scale indexing or sandbox execution.

## Problem

The bot is installed widely but ignored. Root causes in the current product:

1. **Report-card UX** — fixed five-dimension scores, status tables, and empty `_No findings._` sections on every PR.
2. **Noise** — full re-review on every push; no draft/bot filters; stacked `REQUEST_CHANGES` reviews.
3. **False confidence** — guessed test commands and `@`-mentioned “related contributors” with no grounding.
4. **Untrusted blocking** — LLM free-form `verdict` drives merge gates; docs claim score bands that code never enforces; footer says “use your judgment” while hard-blocking.
5. **Thin context** — at most 30 changed files / 200KB; prompt claims “full file context” without saying what was omitted.

## Non-goals

- TREX / sandbox execution / attaching runtime artifacts
- Full-repo graph index or persistent embeddings
- Thumbs-up/down learning loops
- Hallucinated acceptance-criteria shell commands
- Guessing GitHub usernames to `@`-mention

## Product principles

1. **Few, high-confidence comments** — prefer silence over speculation.
2. **Inline-first** — value lives next to the diff; body is a short summary.
3. **Hard block only for hard problems** — soft feedback uses `COMMENT`.
4. **Grounded context only** — rules files, CODEOWNERS, and import-related files; never invent owners or test commands.

## Target experience

### Review body (~8–15 lines)

```markdown
## Chance Review

<2–3 sentence summary>

**Findings**
1. 🔴 <title> — <one sentence>   <!-- only issues that could not be anchored inline -->
2. 🟡 …

**Security:** cleared | flagged — <one sentence>

> Chance PR Reviewer · comments only when confident
```

No dimension score pills, reproducibility/behavior-proof tables, Safety Score banner, acceptance-criteria lists, or guessed contributor `@`-mentions.

Optional collapsed details (only when present): matched CODEOWNERS paths (names as plain text, not forced pings), list of skipped/truncated context files.

### Inline comments

- Max **8** total.
- Prefer `critical` / `warning`.
- Cap `suggestion` at **3**.
- Each comment must reference a path + line that exists on a **diff hunk line** for this commit; invalid entries are dropped before `createReview`.
- Format: `🔴 **CRITICAL:** …` (same severity emoji style as today, without report-card chrome).

## Schema (LLM output)

Replace the current multi-step scorecard schema with:

```ts
{
  summary: string,                    // 2–3 sentences, PR language
  security: {
    status: "cleared" | "flagged",
    detail: string                    // one sentence
  },
  findings: Array<{                   // unanchored issues only
    severity: "critical" | "warning" | "suggestion",
    title: string,
    detail: string
  }>,
  inlineComments: Array<{
    file: string,
    line: number,                     // new-file line from diff hunk
    severity: "critical" | "warning" | "suggestion",
    comment: string                   // specific, actionable
  }>,
  confidence: "high" | "medium" | "low"
}
```

**Removed fields:** `reproducibility`, `behaviorProof`, `dimensions`, `overallScore`, `verdict`, `securityVerdict` (renamed to `security`), `acceptanceCriteria`, `nextStep`, `relatedContributors`.

**Language rule retained:** detect PR title/body language; write all user-facing strings in that language.

## Verdict derivation (code, not LLM)

The model does **not** emit a merge verdict. After validating/filtering comments:

| Condition | GitHub review event | Commit status |
|-----------|---------------------|---------------|
| `confidence === "low"` | Always `COMMENT` | `success` |
| Any remaining `critical` inline/finding **or** `security.status === "flagged"` (and confidence ≥ medium) | `REQUEST_CHANGES` | `failure` |
| Only warnings/suggestions, security cleared | `COMMENT` | `success` |
| Zero findings/inline, security cleared, confidence high or medium | `APPROVE` | `success` |

Notes:

- Mid-severity “caution” no longer blocks merge.
- Status description text: short human summary (e.g. `2 warnings` / `security flagged` / `clean`), not a fake `X.X/5` score.
- If all inline comments are dropped as invalid and no findings remain, treat as clean for approval rules (still `COMMENT` if confidence is low).

## Trigger gating

In `webhook.ts`, before fetching/LLM:

1. Skip if `pull_request.draft === true`.
2. Skip if sender is a bot (`sender.type === "Bot"` or login ends with `[bot]` / equals known bots).
3. Continue to handle `opened` | `synchronize` | `reopened`.

On `synchronize` / re-review success path in `post-review.ts`:

- Before posting a new review, list recent reviews on the PR; **dismiss** prior reviews created by this installation/app that are still `CHANGES_REQUESTED` (with a short dismiss message such as “Superseded by a new Chance review”).
- Still post a new review for the new head SHA (GitHub reviews are commit-scoped).

Out of scope for this change: debounce queues, in-flight locks, webhook async offload (may follow later if timeouts appear).

## Context pack (B)

Extend `fetch-pr.ts` (and a small helper module if needed). Existing GitHub App **Contents: Read** is sufficient.

### Still fetched today

- PR title, body, file list, unified diff, full contents of changed files (caps unchanged unless noted).

### Newly fetched

1. **Rules files** (try head SHA, fall back to default branch; skip missing):
   - `AGENTS.md`, `CLAUDE.md`, `.cursorrules`
   - Up to a small number of files under `.cursor/rules/` (e.g. first 5 text files)
   - Shared byte budget with other extras (recommend **~32KB** total for rules)

2. **CODEOWNERS** (`CODEOWNERS`, `.github/CODEOWNERS`, or `docs/CODEOWNERS`):
   - Parse path patterns → owner teams/users
   - Match against changed files
   - Inject into the prompt as authoritative ownership context
   - Do **not** auto-`@` in the review body; optional plain-text “Matched owners” in `<details>`

3. **Related files via imports**:
   - From changed-file text, extract simple `import` / `require` / `from` path references (TS/JS/Python-style heuristics; best-effort)
   - Resolve relative paths; fetch up to **10** files not already in the changed set
   - Count against the existing **200KB** total context budget (changed files first, then related)
   - Label in the prompt as `Related files (not in diff)`

4. **Omission transparency**:
   - Collect paths skipped for size, binary, cap, or fetch error
   - Pass a short `contextNotes` list into the user message so the model cannot assume it saw the whole repo

### Prompt changes

- Instruct: comment only on high-confidence issues; prefer inline; do not invent test commands or contributors; respect injected rules; use related files to judge call-site/contract breakage; if a path is listed as omitted, do not claim to have read it.
- Drop the six-step scorecard instructions.

## Validation pipeline

After LLM JSON parse + Zod:

1. Drop inline comments whose `file` is not in the PR file list (or related set is irrelevant — must be a file present in the diff for GitHub review comments).
2. Drop comments whose `line` is not a valid right-side line in that file’s diff hunks (parse hunk headers from the unified diff once).
3. Enforce caps: max 8 inline; max 3 suggestions; stable sort critical → warning → suggestion, then truncate.
4. Derive verdict + status as above.
5. Format slim body + post review; dismiss superseded app reviews when applicable.

If `createReview` fails because of remaining bad lines, retry once with comments stripped (body-only) and log the failure — do not leave the placeholder hanging without an update.

## Files expected to change

| File | Change |
|------|--------|
| `src/review-schema.ts` | Slim schema; remove scorecard fields |
| `src/prompt.ts` | New system/user prompts; inject rules, CODEOWNERS, related files, omissions |
| `src/format-review.ts` | Slim markdown body; keep severity-prefixed inline formatting |
| `src/post-review.ts` | Derive verdict; dismiss old reviews; status text without fake scores |
| `src/webhook.ts` | Draft/bot gates |
| `src/fetch-pr.ts` | Rules, CODEOWNERS, related imports, omission notes |
| New helper(s) e.g. `src/context-extras.ts`, `src/diff-lines.ts` | CODEOWNERS parse, import extract, hunk line set |
| `src/llm.ts` | Wire new prompt inputs; no semantic change beyond payload |
| `AGENTS.md` | Document new behavior, remove obsolete score/verdict tables |

No new runtime dependencies required for the first cut (regex/heuristic parsing only).

## Size estimate

- Whole `src/` today ≈ 775 LOC.
- **A** (schema/prompt/format/verdict/gating): ~350–450 LOC rewritten across existing files.
- **B** (context extras): ~150–250 LOC added.
- Ship as **one** implementation effort / PR.

## Success criteria

1. Docs-only / trivial PRs: short summary, 0–2 suggestions, **no** `REQUEST_CHANGES`.
2. Clear secret/injection issues: anchored inline (when possible) + `REQUEST_CHANGES` when confidence ≥ medium.
3. When `AGENTS.md` / CODEOWNERS exist, reviews can reflect those constraints; no fabricated `@user` pings.
4. Invalid inline lines never fail the whole flow silently — filtered or body-only fallback.
5. `npm run typecheck` passes; `AGENTS.md` matches runtime behavior.

## Rollout notes

- Behavior change is user-visible (less blocking, shorter reviews). Call this out in the PR description.
- GitHub App permissions unchanged for B.
- Existing installs need no config migration; score-based branch protection docs in `AGENTS.md` must be updated so teams do not expect `X.X/5` status descriptions.
