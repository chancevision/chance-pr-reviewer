import type { Octokit } from "@octokit/rest";
import type { ReviewResult, ReviewEvent } from "./review-schema.js";
import { formatReviewBody, formatInlineComments } from "./format-review.js";
import { deriveReviewDecision } from "./filter-review.js";
import { setCommitStatus } from "./status.js";
import type { PRData } from "./fetch-pr.js";
import type { CodeownersMatch } from "./context-extras.js";

export async function postPlaceholderComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<number> {
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: "⏳ AI code review in progress...",
  });
  return data.id;
}

export async function updatePlaceholderComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}

export async function deletePlaceholderComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
): Promise<void> {
  await octokit.rest.issues.deleteComment({
    owner,
    repo,
    comment_id: commentId,
  });
}

function isChanceReviewBody(body: string | null | undefined): boolean {
  if (!body) return false;
  return (
    body.startsWith("## Chance Review") || body.startsWith("## AI Code Review")
  );
}

async function dismissSupersededReviews(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<void> {
  try {
    const reviews = await octokit.paginate(octokit.pulls.listReviews, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    // Only dismiss our own prior CHANGES_REQUESTED reviews (by body marker),
    // never other bots' reviews.
    const targets = reviews.filter(
      (r) => r.state === "CHANGES_REQUESTED" && isChanceReviewBody(r.body),
    );

    for (const r of targets) {
      if (!r.id) continue;
      try {
        await octokit.pulls.dismissReview({
          owner,
          repo,
          pull_number: pullNumber,
          review_id: r.id,
          message: "Superseded by a new Chance review",
        });
      } catch (err) {
        console.warn(`Failed to dismiss review ${r.id}:`, err);
      }
    }
  } catch (err) {
    console.warn("Failed to list/dismiss prior reviews:", err);
  }
}

async function createReviewWithFallback(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  body: string,
  event: ReviewEvent,
  comments: Array<{ path: string; line: number; body: string }>,
): Promise<string> {
  try {
    const result = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      body,
      event,
      comments,
    });
    return result.data.html_url;
  } catch (err) {
    if (comments.length === 0) throw err;
    console.warn(
      "createReview with inline comments failed; retrying body-only:",
      err,
    );
    const result = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      body,
      event,
      comments: [],
    });
    return result.data.html_url;
  }
}

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  review: ReviewResult,
  diff: string,
  changedFilePaths: string[],
  extras?: {
    codeownersMatches?: CodeownersMatch[];
    contextNotes?: string[];
  },
): Promise<string> {
  const decision = deriveReviewDecision(
    review,
    diff,
    new Set(changedFilePaths),
  );
  const body = formatReviewBody(decision.review, {
    codeownersMatches: extras?.codeownersMatches,
    contextNotes: extras?.contextNotes,
  });
  const comments = formatInlineComments(decision.inlineComments);

  await dismissSupersededReviews(octokit, owner, repo, pullNumber);

  return createReviewWithFallback(
    octokit,
    owner,
    repo,
    pullNumber,
    headSha,
    body,
    decision.event,
    comments,
  );
}

export async function runReviewFlow(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  prData: PRData,
  runReview: () => Promise<ReviewResult>,
): Promise<string> {
  const headSha = prData.headSha;
  await setCommitStatus(octokit, owner, repo, headSha, "pending", "AI review in progress...");
  const placeholderId = await postPlaceholderComment(octokit, owner, repo, pullNumber);

  try {
    const review = await runReview();

    const { data: currentPR } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    if (currentPR.state !== "open") {
      console.log(`PR #${pullNumber} was closed during review — skipping post`);
      await updatePlaceholderComment(
        octokit,
        owner,
        repo,
        placeholderId,
        "🛑 PR was closed before the AI review completed. Review was cancelled.",
      );
      return "";
    }

    const decision = deriveReviewDecision(
      review,
      prData.diff,
      new Set(prData.changedFilePaths),
    );

    await deletePlaceholderComment(octokit, owner, repo, placeholderId);
    await setCommitStatus(
      octokit,
      owner,
      repo,
      headSha,
      decision.statusState,
      decision.statusDescription,
    );

    const body = formatReviewBody(decision.review, {
      codeownersMatches: prData.codeownersMatches,
      contextNotes: prData.contextNotes,
    });
    const comments = formatInlineComments(decision.inlineComments);

    await dismissSupersededReviews(octokit, owner, repo, pullNumber);

    return createReviewWithFallback(
      octokit,
      owner,
      repo,
      pullNumber,
      headSha,
      body,
      decision.event,
      comments,
    );
  } catch (err) {
    await setCommitStatus(octokit, owner, repo, headSha, "error", "Review failed");
    await updatePlaceholderComment(
      octokit,
      owner,
      repo,
      placeholderId,
      "❌ AI code review failed. Check server logs for details.",
    );
    throw err;
  }
}
