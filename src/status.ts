import type { Octokit } from "@octokit/rest";

export async function setCommitStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  state: "pending" | "success" | "error" | "failure",
  description: string,
): Promise<void> {
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    description,
    context: "agent-pr-review",
  });
}
