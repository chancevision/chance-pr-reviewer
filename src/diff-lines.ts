/**
 * Parse a unified diff and return right-hand (new-file) line numbers
 * that GitHub accepts for pull request review comments.
 *
 * Only lines starting with `+` or ` ` (context) in a hunk are commentable;
 * deleted (`-`) lines are not.
 */
export function buildCommentableLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      currentFile = null;
      inHunk = false;
      continue;
    }

    // Prefer b/ path (new file). Handle renames / new files.
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).trim();
      if (path === "/dev/null") {
        currentFile = null;
      } else {
        currentFile = path.startsWith("b/") ? path.slice(2) : path;
        if (!result.has(currentFile)) result.set(currentFile, new Set());
      }
      inHunk = false;
      continue;
    }

    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile) continue;

    if (raw.startsWith("+") || raw.startsWith(" ")) {
      result.get(currentFile)!.add(newLine);
      newLine += 1;
    } else if (raw.startsWith("-")) {
      // deleted line — does not advance new-file line
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
    }
  }

  return result;
}
