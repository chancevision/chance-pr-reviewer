import type { Octokit } from "@octokit/rest";
import type { ReviewResult, Verdict } from "./review-schema.js";
import { formatReviewBody, formatInlineComments } from "./format-review.js";
import { setCommitStatus } from "./status.js";

function verdictToEvent(verdict: Verdict): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  switch (verdict) {
    case "VERY_SAFE":
      return "APPROVE";
    case "SAFE":
      return "COMMENT";
    case "CAUTION":
    case "RISKY":
      return "REQUEST_CHANGES";
  }
}

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

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  review: ReviewResult,
): Promise<string> {
  const body = formatReviewBody(review);
  const comments = formatInlineComments(review.inlineComments);

  const result = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: headSha,
    body,
    event: verdictToEvent(review.verdict),
    comments,
  });

  return result.data.html_url;
}

export async function runReviewFlow(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  runReview: () => Promise<ReviewResult>,
): Promise<string> {
  await setCommitStatus(octokit, owner, repo, headSha, "pending", "AI review in progress...");
  const placeholderId = await postPlaceholderComment(octokit, owner, repo, pullNumber);

  try {
    const review = await runReview();

    // Check if PR was closed while we were reviewing
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

    const scoreDesc = `${review.overallScore.toFixed(1)}/5 — ${review.verdict}`;
    const statusState =
      review.verdict === "VERY_SAFE" || review.verdict === "SAFE"
        ? "success"
        : "failure";

    await deletePlaceholderComment(octokit, owner, repo, placeholderId);
    await setCommitStatus(octokit, owner, repo, headSha, statusState, scoreDesc);

    const reviewUrl = await postReview(octokit, owner, repo, pullNumber, headSha, review);
    return reviewUrl;
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
