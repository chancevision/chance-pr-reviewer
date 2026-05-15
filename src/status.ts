import type { Octokit } from "@octokit/rest";

export async function setCommitStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  state: "pending" | "success" | "error" | "failure",
  description: string,
): Promise<boolean> {
  try {
    await octokit.rest.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state,
      description,
      context: "agent-pr-review",
    });
    return true;
  } catch (err: any) {
    if (err.status === 403) {
      console.warn(
        `Commit status skipped: missing "Commit statuses: Read & Write" permission in GitHub App settings.`,
      );
      return false;
    }
    throw err;
  }
}
