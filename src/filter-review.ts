import type {
  Confidence,
  InlineComment,
  ReviewEvent,
  ReviewResult,
  Severity,
} from "./review-schema.js";
import { buildCommentableLines } from "./diff-lines.js";

const MAX_INLINE = 8;
const MAX_SUGGESTIONS = 3;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

export interface ReviewDecision {
  event: ReviewEvent;
  statusState: "success" | "failure";
  statusDescription: string;
  inlineComments: InlineComment[];
  review: ReviewResult;
}

export function filterInlineComments(
  comments: InlineComment[],
  diff: string,
  changedFiles: Set<string>,
): InlineComment[] {
  const commentable = buildCommentableLines(diff);

  const valid = comments.filter((c) => {
    if (!changedFiles.has(c.file)) return false;
    const lines = commentable.get(c.file);
    return lines?.has(c.line) ?? false;
  });

  valid.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const out: InlineComment[] = [];
  let suggestions = 0;
  for (const c of valid) {
    if (out.length >= MAX_INLINE) break;
    if (c.severity === "suggestion") {
      if (suggestions >= MAX_SUGGESTIONS) continue;
      suggestions += 1;
    }
    out.push(c);
  }
  return out;
}

function hasCritical(
  review: ReviewResult,
  inlineComments: InlineComment[],
): boolean {
  if (inlineComments.some((c) => c.severity === "critical")) return true;
  return review.findings.some((f) => f.severity === "critical");
}

function countBySeverity(
  review: ReviewResult,
  inlineComments: InlineComment[],
): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const c of inlineComments) counts[c.severity] += 1;
  for (const f of review.findings) counts[f.severity] += 1;
  return counts;
}

export function statusDescriptionFor(
  review: ReviewResult,
  inlineComments: InlineComment[],
  event: ReviewEvent,
): string {
  if (review.security.status === "flagged" && review.confidence !== "low") {
    return "security flagged";
  }
  const c = countBySeverity(review, inlineComments);
  if (c.critical > 0) return `${c.critical} critical`;
  if (c.warning > 0) return `${c.warning} warning${c.warning === 1 ? "" : "s"}`;
  if (c.suggestion > 0) {
    return `${c.suggestion} suggestion${c.suggestion === 1 ? "" : "s"}`;
  }
  if (event === "APPROVE") return "clean";
  if (review.confidence === "low") return "low confidence";
  return "clean";
}

/**
 * Derive GitHub review event + commit status from filtered review output.
 * LLM confidence "low" never blocks merge.
 */
export function deriveReviewDecision(
  review: ReviewResult,
  diff: string,
  changedFiles: Set<string>,
): ReviewDecision {
  const inlineComments = filterInlineComments(
    review.inlineComments,
    diff,
    changedFiles,
  );
  const filtered: ReviewResult = { ...review, inlineComments };

  const confidence: Confidence = review.confidence;
  const critical = hasCritical(filtered, inlineComments);
  const securityFlagged = review.security.status === "flagged";

  let event: ReviewEvent;
  if (confidence === "low") {
    event = "COMMENT";
  } else if (critical || securityFlagged) {
    event = "REQUEST_CHANGES";
  } else if (
    inlineComments.length === 0 &&
    review.findings.length === 0 &&
    !securityFlagged
  ) {
    event = "APPROVE";
  } else {
    event = "COMMENT";
  }

  const statusState = event === "REQUEST_CHANGES" ? "failure" : "success";
  const statusDescription = statusDescriptionFor(
    filtered,
    inlineComments,
    event,
  );

  return {
    event,
    statusState,
    statusDescription,
    inlineComments,
    review: filtered,
  };
}
