import type { Octokit } from "@octokit/rest";
import {
  extractImportPaths,
  importFetchCandidates,
  matchCodeowners,
  parseCodeowners,
  resolveImportPath,
  type CodeownersMatch,
} from "./context-extras.js";

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
  changedFilePaths: string[];
  fileContexts: FileContext[];
  relatedContexts: FileContext[];
  rulesFiles: FileContext[];
  codeownersText: string | null;
  codeownersMatches: CodeownersMatch[];
  contextNotes: string[];
}

const MAX_FILE_SIZE = 64 * 1024;
const MAX_TOTAL_CONTEXT = 200 * 1024;
const MAX_FILES = 30;
const MAX_RELATED = 10;
const MAX_RULES_BYTES = 32 * 1024;

const RULE_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md", ".cursorrules"];
const CODEOWNERS_CANDIDATES = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

function isTextContent(content: string): boolean {
  if (content.includes("\0")) return false;
  const sample = content.slice(0, 512);
  const nonPrintable = sample.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
  if (nonPrintable && nonPrintable.length > sample.length * 0.1) return false;
  return true;
}

async function fetchTextFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; size: number } | null> {
  try {
    const response = await octokit.repos.getContent({ owner, repo, path, ref });
    const data = response.data as {
      content?: string;
      encoding?: string;
      size?: number;
      type?: string;
    };
    if (data.type && data.type !== "file") return null;
    if (data.size && data.size > MAX_FILE_SIZE) return null;
    if (data.encoding === "base64" && data.content) {
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      if (!isTextContent(decoded)) return null;
      return { content: decoded, size: Buffer.byteLength(decoded, "utf-8") };
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchFirstExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  refs: string[],
): Promise<{ path: string; content: string } | null> {
  for (const ref of refs) {
    for (const path of paths) {
      const hit = await fetchTextFile(octokit, owner, repo, path, ref);
      if (hit) return { path, content: hit.content };
    }
  }
  return null;
}

async function listCursorRules(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: ".cursor/rules",
      ref,
    });
    if (!Array.isArray(response.data)) return [];
    return response.data
      .filter((e) => e.type === "file" && typeof e.path === "string")
      .map((e) => e.path as string)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function fetchPRData(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PRData> {
  const [pr, prFiles, prDiff, repoInfo] = await Promise.all([
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
    octokit.repos.get({ owner, repo }),
  ]);

  const filesList = prFiles
    .map(
      (f: { filename: string; status: string; additions: number; deletions: number }) =>
        `  ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`,
    )
    .join("\n");

  const headSha = pr.data.head.sha;
  const defaultBranch = repoInfo.data.default_branch;
  const refs = [headSha, defaultBranch];
  const contextNotes: string[] = [];
  const changedFilePaths = prFiles.map(
    (f: { filename: string }) => f.filename as string,
  );

  // --- Changed file full contents ---
  const fileContexts: FileContext[] = [];
  const filesToFetch = prFiles.slice(0, MAX_FILES);
  if (prFiles.length > MAX_FILES) {
    contextNotes.push(
      `Only first ${MAX_FILES} of ${prFiles.length} changed files fetched for full content`,
    );
  }

  let totalBytes = 0;
  for (const f of filesToFetch) {
    const file = f as {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
    };
    if (file.status === "removed") continue;

    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: file.filename,
        ref: headSha,
      });
      const data = response.data as {
        content?: string;
        encoding?: string;
        size?: number;
      };
      if (data.size && data.size > MAX_FILE_SIZE) {
        contextNotes.push(`Skipped ${file.filename} (exceeds ${MAX_FILE_SIZE} bytes)`);
        continue;
      }
      if (data.encoding === "base64" && data.content) {
        const decoded = Buffer.from(data.content, "base64").toString("utf-8");
        if (!isTextContent(decoded)) {
          contextNotes.push(`Skipped ${file.filename} (binary)`);
          continue;
        }
        const byteSize = Buffer.byteLength(decoded, "utf-8");
        if (totalBytes + byteSize > MAX_TOTAL_CONTEXT) {
          contextNotes.push(
            `Stopped fetching changed files at ${file.filename} (context budget)`,
          );
          break;
        }
        fileContexts.push({ path: file.filename, content: decoded });
        totalBytes += byteSize;
      }
    } catch {
      contextNotes.push(`Failed to fetch ${file.filename}`);
    }
  }

  // --- Rules files ---
  const rulesFiles: FileContext[] = [];
  let rulesBytes = 0;
  for (const path of RULE_FILE_CANDIDATES) {
    if (rulesBytes >= MAX_RULES_BYTES) break;
    const hit = await fetchFirstExisting(octokit, owner, repo, [path], refs);
    if (!hit) continue;
    const size = Buffer.byteLength(hit.content, "utf-8");
    if (rulesBytes + size > MAX_RULES_BYTES) {
      contextNotes.push(`Skipped rules file ${path} (rules budget)`);
      continue;
    }
    rulesFiles.push(hit);
    rulesBytes += size;
  }

  for (const ref of refs) {
    if (rulesBytes >= MAX_RULES_BYTES) break;
    const rulePaths = await listCursorRules(octokit, owner, repo, ref);
    for (const path of rulePaths) {
      if (rulesFiles.some((r) => r.path === path)) continue;
      if (rulesBytes >= MAX_RULES_BYTES) break;
      const hit = await fetchTextFile(octokit, owner, repo, path, ref);
      if (!hit) continue;
      if (rulesBytes + hit.size > MAX_RULES_BYTES) {
        contextNotes.push(`Skipped rules file ${path} (rules budget)`);
        continue;
      }
      rulesFiles.push({ path, content: hit.content });
      rulesBytes += hit.size;
    }
    if (rulePaths.length > 0) break;
  }

  // --- CODEOWNERS ---
  const codeownersHit = await fetchFirstExisting(
    octokit,
    owner,
    repo,
    CODEOWNERS_CANDIDATES,
    refs,
  );
  const codeownersText = codeownersHit?.content ?? null;
  const codeownersMatches = codeownersText
    ? matchCodeowners(changedFilePaths, parseCodeowners(codeownersText))
    : [];

  // --- Related files via imports ---
  const relatedContexts: FileContext[] = [];
  const changedSet = new Set(changedFilePaths);
  const already = new Set(fileContexts.map((f) => f.path));
  const candidates: string[] = [];

  for (const fc of fileContexts) {
    for (const spec of extractImportPaths(fc.content)) {
      const resolved = resolveImportPath(fc.path, spec);
      if (!resolved) continue;
      for (const cand of importFetchCandidates(resolved)) {
        if (changedSet.has(cand) || already.has(cand)) continue;
        if (!candidates.includes(cand)) candidates.push(cand);
      }
    }
  }

  for (const path of candidates) {
    if (relatedContexts.length >= MAX_RELATED) {
      contextNotes.push(
        `Related-file cap reached (${MAX_RELATED}); further imports not fetched`,
      );
      break;
    }
    if (totalBytes >= MAX_TOTAL_CONTEXT) {
      contextNotes.push("Stopped related files (context budget)");
      break;
    }
    const hit = await fetchTextFile(octokit, owner, repo, path, headSha);
    if (!hit) continue;
    if (totalBytes + hit.size > MAX_TOTAL_CONTEXT) {
      contextNotes.push(`Skipped related ${path} (context budget)`);
      continue;
    }
    relatedContexts.push({ path, content: hit.content });
    already.add(path);
    totalBytes += hit.size;
  }

  return {
    title: pr.data.title,
    body: pr.data.body,
    files: filesList,
    diff: prDiff.data as unknown as string,
    headSha,
    changedFilePaths,
    fileContexts,
    relatedContexts,
    rulesFiles,
    codeownersText,
    codeownersMatches,
    contextNotes,
  };
}
