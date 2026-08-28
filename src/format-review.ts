import type { ReviewResult, InlineComment, Finding } from "./review-schema.js";
import type { CodeownersMatch } from "./context-extras.js";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "🔵",
};

function formatFinding(f: Finding, index: number): string {
  const emoji = SEVERITY_EMOJI[f.severity] || "⚪";
  return `${index}. ${emoji} ${f.title} — ${f.detail}`;
}

export interface FormatReviewOptions {
  codeownersMatches?: CodeownersMatch[];
  contextNotes?: string[];
}

export function formatReviewBody(
  review: ReviewResult,
  opts: FormatReviewOptions = {},
): string {
  let body = `## Chance Review\n\n`;
  body += `${review.summary}\n\n`;

  if (review.findings.length > 0) {
    body += `**Findings**\n`;
    review.findings.forEach((f, i) => {
      body += `${formatFinding(f, i + 1)}\n`;
    });
    body += `\n`;
  }

  const secEmoji = review.security.status === "cleared" ? "✅" : "🔴";
  body += `**Security:** ${secEmoji} ${review.security.status} — ${review.security.detail}\n\n`;

  const matches = opts.codeownersMatches ?? [];
  const notes = opts.contextNotes ?? [];
  if (matches.length > 0 || notes.length > 0) {
    body += `<details>\n<summary>Review context</summary>\n\n`;
    if (matches.length > 0) {
      body += `**Matched owners** (from CODEOWNERS — not notified):\n`;
      for (const m of matches) {
        body += `- \`${m.path}\` → ${m.owners.join(", ")} (rule \`${m.pattern}\`)\n`;
      }
      body += `\n`;
    }
    if (notes.length > 0) {
      body += `**Context notes:**\n`;
      for (const n of notes) {
        body += `- ${n}\n`;
      }
      body += `\n`;
    }
    body += `</details>\n\n`;
  }

  body += `> Chance PR Reviewer · comments only when confident\n`;
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
