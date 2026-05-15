const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the pull request diff below.
Respond with valid JSON only (no markdown fences). Use this schema:

{
  "summary": "2-3 sentence overview of the PR changes",
  "dimensions": {
    "codeQuality":    { "score": 1-5, "issues": ["..."], "highlights": ["..."] },
    "security":       { "score": 1-5, "issues": ["..."], "highlights": ["..."] },
    "performance":    { "score": 1-5, "issues": ["..."], "highlights": ["..."] },
    "testing":        { "score": 1-5, "issues": ["..."], "highlights": ["..."] },
    "consistency":    { "score": 1-5, "issues": ["..."], "highlights": ["..."] }
  },
  "overallScore": 1.0-5.0,
  "verdict": "VERY_SAFE" | "SAFE" | "CAUTION" | "RISKY",
  "inlineComments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "critical" | "warning" | "suggestion",
      "comment": "specific, actionable feedback"
    }
  ]
}

Rules:
- Score 1 = critical problems, must fix before merge. Score 5 = flawless.
- overallScore is the average of the 5 dimension scores (1 decimal place).
- Report only actionable issues. Be specific with file paths and line numbers.
- Praise genuinely good patterns in "highlights".
- Flag any hardcoded secrets, passwords, keys, or tokens as CRITICAL.
- Consider the language and framework visible in the diff context.
- If a dimension has no issues, score 5 and note why in highlights.
- Use the line numbers from the diff hunk headers (new file lines) for inlineComments.
- Keep each issue/highlight concise — 1 sentence each.`;

export function buildUserMessage(opts: {
  title: string;
  body: string | null;
  files: string;
  diff: string;
}): string {
  return [
    "## PR Title",
    opts.title,
    "",
    "## PR Description",
    opts.body || "(no description)",
    "",
    "## Changed Files",
    opts.files,
    "",
    "## Diff",
    opts.diff,
  ].join("\n");
}

export function buildMessages(opts: {
  title: string;
  body: string | null;
  files: string;
  diff: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(opts) },
  ];
}
