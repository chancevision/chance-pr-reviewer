import type { ReviewResult, InlineComment } from "./review-schema.js";

const DIMENSION_LABELS: Record<string, string> = {
  codeQuality: "Code Quality & Readability",
  security: "Security",
  performance: "Performance",
  testing: "Testing & Reliability",
  consistency: "Consistency & Best Practices",
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "🔵",
};

const VERDICT_EMOJI: Record<string, string> = {
  VERY_SAFE: "🟢",
  SAFE: "🟢",
  CAUTION: "🟡",
  RISKY: "🔴",
};

function formatDimension(
  key: string,
  dim: { score: number; issues: string[]; highlights: string[] },
): string {
  const label = DIMENSION_LABELS[key] || key;
  const bar = "█".repeat(dim.score) + "░".repeat(5 - dim.score);
  let out = `### ${label} — ${bar} ${dim.score}/5\n\n`;

  if (dim.highlights.length > 0) {
    out += "**Highlights:**\n";
    for (const h of dim.highlights) {
      out += `- ✅ ${h}\n`;
    }
    out += "\n";
  }

  if (dim.issues.length > 0) {
    out += "**Issues:**\n";
    for (const i of dim.issues) {
      out += `- ⚠️ ${i}\n`;
    }
    out += "\n";
  }

  if (dim.issues.length === 0 && dim.highlights.length === 0) {
    out += "_No findings._\n\n";
  }

  return out;
}

export function formatReviewBody(review: ReviewResult): string {
  const v = VERDICT_EMOJI[review.verdict] || "⚪";
  let body = `## 🤖 AI Code Review\n\n`;
  body += `**Summary:** ${review.summary}\n\n`;
  body += `---\n\n`;

  for (const [key, dim] of Object.entries(review.dimensions)) {
    body += formatDimension(key, dim);
  }

  body += `---\n\n`;
  body += `## ${v} Safety Score: **${review.overallScore.toFixed(1)}/5** — ${review.verdict}\n\n`;
  body += `> Reviewed by agent-pr-review AI. This is automated feedback — use your judgment.\n`;

  return body;
}

export function formatInlineComments(
  inlineComments: InlineComment[],
): Array<{ path: string; line: number; body: string }> {
  return inlineComments.map((ic) => ({
    path: ic.file,
    line: ic.line,
    body: `${SEVERITY_EMOJI[ic.severity] || "⚪"} **${ic.severity.toUpperCase()}:** ${ic.comment}`,
  }));
}
