import type { Octokit } from "@octokit/rest";

export interface FileContext {
  path: string;
  content: string;
}

export interface PRData {
  title: string;
  body: string | null;
  files: string;
  diff: string;
  headSha: string;
  fileContexts: FileContext[];
}

const MAX_FILE_SIZE = 64 * 1024; // 64 KB — skip files larger than this
const MAX_TOTAL_CONTEXT = 200 * 1024; // 200 KB total across all files
const MAX_FILES = 30; // max files to fetch full content for

function isTextContent(content: string): boolean {
  // Skip content that looks binary (contains null bytes or is mostly non-printable)
  if (content.includes("\0")) return false;
  const sample = content.slice(0, 512);
  const nonPrintable = sample.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
  if (nonPrintable && nonPrintable.length > sample.length * 0.1) return false;
  return true;
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

  const headSha = pr.data.head.sha;

  // Fetch full file contents from the PR head branch for context
  const fileContexts: FileContext[] = [];
  const filesToFetch = prFiles.slice(0, MAX_FILES);
  let totalBytes = 0;

  for (const f of filesToFetch) {
    const file = f as { filename: string; status: string; additions: number; deletions: number };
    if (file.status === "removed") continue;

    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: file.filename,
        ref: headSha,
      });

      const data = response.data as { content?: string; encoding?: string; size?: number };
      if (data.size && data.size > MAX_FILE_SIZE) continue;

      if (data.encoding === "base64" && data.content) {
        const decoded = Buffer.from(data.content, "base64").toString("utf-8");
        if (!isTextContent(decoded)) continue;

        const byteSize = Buffer.byteLength(decoded, "utf-8");
        if (totalBytes + byteSize > MAX_TOTAL_CONTEXT) break;

        fileContexts.push({ path: file.filename, content: decoded });
        totalBytes += byteSize;
      }
    } catch {
      // Skip files that can't be fetched (e.g., submodules, deleted, too large)
    }
  }

  return {
    title: pr.data.title,
    body: pr.data.body,
    files: filesList,
    diff: prDiff.data as unknown as string,
    headSha,
    fileContexts,
  };
}
