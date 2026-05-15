import type { Octokit } from "@octokit/rest";

export interface PRData {
  title: string;
  body: string | null;
  files: string;
  diff: string;
  headSha: string;
}

export async function fetchPRData(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PRData> {
  const [pr, prFiles, prDiff] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.paginate(octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
    octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: "application/vnd.github.v3.diff" },
    }),
  ]);

  const filesList = prFiles
    .map(
      (f: { filename: string; status: string; additions: number; deletions: number }) =>
        `  ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`,
    )
    .join("\n");

  return {
    title: pr.data.title,
    body: pr.data.body,
    files: filesList,
    diff: prDiff.data as unknown as string,
    headSha: pr.data.head.sha,
  };
}
