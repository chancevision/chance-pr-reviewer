const SYSTEM_PROMPT = `You are an expert code reviewer writing high-signal GitHub PR feedback.
Respond with valid JSON only (no markdown fences). Use this schema:

{
  "summary": "2-3 sentence overview of the PR changes and intent",
  "security": {
    "status": "cleared" | "flagged",
    "detail": "One sentence on secrets, auth, injection, paths, deps, permissions"
  },
  "findings": [
    {
      "severity": "critical" | "warning" | "suggestion",
      "title": "short title",
      "detail": "one sentence — only for issues you cannot anchor to a diff line"
    }
  ],
  "inlineComments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "critical" | "warning" | "suggestion",
      "comment": "specific, actionable feedback"
    }
  ],
  "confidence": "high" | "medium" | "low"
}

Language: Detect the language of the PR title and description. Write ALL user-facing strings (summary, security.detail, findings, inlineComments) in that same language.

Review rules:
- Prefer silence over speculation. Comment only when reasonably confident.
- Prefer inlineComments on changed lines. Put an issue in findings only if it cannot be anchored to a diff line.
- At most 8 inlineComments; at most 3 suggestions. Prefer critical/warning.
- Use new-file line numbers from diff hunk headers for inlineComments.
- Do NOT invent test commands, CI steps, or GitHub usernames.
- Do NOT @-mention anyone.
- Check security: secrets, credentials, injection, path traversal, unsafe deps, new permission surfaces. Use status "flagged" only for real concerns.
- Respect any repository rules files included in the user message.
- Use related files (not in the diff) to judge call-site / contract breakage.
- If a path is listed under context notes as omitted/skipped, do not claim you read it.
- Set confidence to "low" when the diff is too large, context is missing, or you are unsure.`;

export interface PromptExtras {
  title: string;
  body: string | null;
  files: string;
  diff: string;
  fileContexts?: Array<{ path: string; content: string }>;
  relatedContexts?: Array<{ path: string; content: string }>;
  rulesFiles?: Array<{ path: string; content: string }>;
  codeownersText?: string | null;
  codeownersMatches?: Array<{ path: string; owners: string[]; pattern: string }>;
  contextNotes?: string[];
}

function pushFileSection(
  sections: string[],
  heading: string,
  files: Array<{ path: string; content: string }>,
): void {
  if (files.length === 0) return;
  sections.push(`## ${heading}`);
  for (const fc of files) {
    sections.push(`### ${fc.path}`);
    sections.push("```");
    sections.push(fc.content);
    sections.push("```");
    sections.push("");
  }
}

export function buildUserMessage(opts: PromptExtras): string {
  const sections = [
    "## PR Title",
    opts.title,
    "",
    "## PR Description",
    opts.body || "(no description)",
    "",
  ];

  if (opts.contextNotes && opts.contextNotes.length > 0) {
    sections.push("## Context notes (omissions / limits)");
    for (const n of opts.contextNotes) {
      sections.push(`- ${n}`);
    }
    sections.push("");
  }

  pushFileSection(sections, "Repository rules", opts.rulesFiles ?? []);

  if (opts.codeownersText) {
    sections.push("## CODEOWNERS (authoritative ownership)");
    sections.push("```");
    sections.push(opts.codeownersText);
    sections.push("```");
    sections.push("");
  }

  if (opts.codeownersMatches && opts.codeownersMatches.length > 0) {
    sections.push("## Matched CODEOWNERS for changed files");
    for (const m of opts.codeownersMatches) {
      sections.push(`- ${m.path}: ${m.owners.join(", ")} (rule ${m.pattern})`);
    }
    sections.push("");
  }

  pushFileSection(
    sections,
    "Full file contents of changed files (use to resolve references)",
    opts.fileContexts ?? [],
  );

  pushFileSection(
    sections,
    "Related files (not in diff — imported by changed files)",
    opts.relatedContexts ?? [],
  );

  sections.push("## Changed Files", opts.files, "", "## Diff", opts.diff);

  return sections.join("\n");
}

export function buildMessages(
  opts: PromptExtras,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(opts) },
  ];
}
