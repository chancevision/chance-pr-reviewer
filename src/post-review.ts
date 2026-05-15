import type { Octokit } from "@octokit/rest";
import type { ReviewResult } from "./review-schema.js";
import { formatReviewBody, formatInlineComments } from "./format-review.js";

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
