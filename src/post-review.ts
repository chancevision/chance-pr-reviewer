import type { Octokit } from "@octokit/rest";
import type { ReviewResult } from "./review-schema.js";
import { formatReviewBody, formatInlineComments } from "./format-review.js";
import { setCommitStatus } from "./status.js";

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
    event: "COMMENT",
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

    const scoreDesc = `${review.overallScore.toFixed(1)}/5 — ${review.verdict}`;
    const statusState = review.verdict === "RISKY" ? "failure" : "success";

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
