import type { ReviewResult, InlineComment } from "./review-schema.js";

const DIMENSION_LABELS: Record<string, string> = {
  codeQuality: "Code Quality & Readability",
  security: "Security",
  performance: "Performance",
  testing: "Testing & Reliability",
  consistency: "Consistency & Best Practices",
};

const SCORE_PILL: Record<number, string> = {
  1: "`🔴 1`",
  2: "`🟠 2`",
  3: "`🟡 3`",
  4: "`🟢 4`",
  5: "`🟢 5`",
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
  const pill = SCORE_PILL[dim.score] || `\`  ${dim.score}\``;
  let out = `**${label}** ${pill}\n`;

  if (dim.highlights.length > 0) {
    for (const h of dim.highlights) {
      out += `- ✅ ${h}\n`;
    }
  }

  if (dim.issues.length > 0) {
    for (const i of dim.issues) {
      out += `- ⚠️ ${i}\n`;
    }
  }

  if (dim.issues.length === 0 && dim.highlights.length === 0) {
    out += "_No findings._\n";
  }

  out += "\n";
  return out;
}

export function formatReviewBody(review: ReviewResult): string {
  const v = VERDICT_EMOJI[review.verdict] || "⚪";
  const sevV = review.securityVerdict.status === "cleared" ? "✅" : "🔴";
  const repV = review.reproducibility.possible ? "✅" : "⚠️";
  const proofV = review.behaviorProof.present ? "✅" : "⚠️";

  let body = `## AI Code Review\n\n`;
  body += `> ${review.summary}\n\n`;

  // Quick status table
  body += `| | |\n|---|---|\n`;
  body += `| Reproducibility | ${repV} ${review.reproducibility.method} |\n`;
  body += `| Behavior Proof | ${proofV} ${review.behaviorProof.evidence} |\n`;
  body += `| Security | ${sevV} ${review.securityVerdict.status} |\n`;
  body += `| Next Step | ${review.nextStep} |\n`;
  body += `\n`;

  // Scores
  for (const [key, dim] of Object.entries(review.dimensions)) {
    body += formatDimension(key, dim);
  }

  body += `---\n`;
  body += `**${v} Safety Score: ${review.overallScore.toFixed(1)}/5 — ${review.verdict}**\n\n`;

  // Collapsible details (clawsweeper-style)
  body += `<details>\n<summary>Review details</summary>\n\n`;
  body += `**Evidence from source:** ${review.reproducibility.detail}\n\n`;
  body += `**Security:** ${review.securityVerdict.detail}\n\n`;

  if (review.acceptanceCriteria.length > 0) {
    body += `**Acceptance criteria:**\n`;
    for (const cmd of review.acceptanceCriteria) {
      body += `- \`${cmd}\`\n`;
    }
    body += `\n`;
  }

  if (review.relatedContributors.length > 0) {
    body += `**Likely related contributors:**\n`;
    for (const c of review.relatedContributors) {
      body += `- **@${c.name}** — ${c.role}: ${c.reason}\n`;
    }
    body += `\n`;
  }

  body += `</details>\n\n`;
  body += `> Reviewed by Chance PR Reviewer. This is automated feedback — use your judgment.\n`;

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
