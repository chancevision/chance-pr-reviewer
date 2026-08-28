export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export interface CodeownersMatch {
  path: string;
  owners: string[];
  pattern: string;
}

/** Parse CODEOWNERS file contents into ordered rules (last match wins). */
export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [pattern, ...owners] = parts;
    rules.push({ pattern, owners });
  }
  return rules;
}

/**
 * Minimal CODEOWNERS glob: supports `*`, `**`, leading `/` (repo-root),
 * and directory patterns ending in `/`.
 */
function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  if (p.startsWith("/")) p = p.slice(1);
  else p = "**/" + p;
  if (p.endsWith("/")) p = p + "**";

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (p[i + 1] === "/") i += 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Last matching rule wins (GitHub CODEOWNERS semantics). */
export function matchCodeowners(
  paths: string[],
  rules: CodeownersRule[],
): CodeownersMatch[] {
  const matches: CodeownersMatch[] = [];
  for (const path of paths) {
    let hit: CodeownersRule | null = null;
    for (const rule of rules) {
      try {
        if (patternToRegex(rule.pattern).test(path)) hit = rule;
      } catch {
        // ignore bad patterns
      }
    }
    if (hit) {
      matches.push({ path, owners: hit.owners, pattern: hit.pattern });
    }
  }
  return matches;
}

const IMPORT_RE = [
  // JS/TS: import x from './foo' | from "./foo.js" | from '@/x'
  /\bfrom\s+['"]([^'"]+)['"]/g,
  // JS/TS: import('./foo') | require('./foo')
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Python: from .foo import | from foo.bar import
  /^\s*from\s+(\.[\w.]+|\w[\w.]*)\s+import\s+/gm,
  // Python: import foo.bar  (not JS `import x from`)
  /^\s*import\s+(\w[\w.]*(?:\s*,\s*\w[\w.]*)*)\s*(?:#.*)?$/gm,
];

/** Best-effort extraction of import-like path strings from source text. */
export function extractImportPaths(source: string): string[] {
  const found = new Set<string>();
  for (const re of IMPORT_RE) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found];
}

/**
 * Resolve a relative import against an importing file path.
 * Returns null for bare package names / URLs / non-relative non-aliased paths
 * we cannot map to a repo file without a resolver.
 */
export function resolveImportPath(
  fromFile: string,
  spec: string,
): string | null {
  // Skip URLs and data:
  if (/^[a-z]+:/i.test(spec)) return null;

  // Python dotted module → path heuristic (foo.bar → foo/bar.py) only for relative
  if (spec.startsWith(".")) {
    // Could be JS relative or Python relative package
    const dir = fromFile.includes("/")
      ? fromFile.slice(0, fromFile.lastIndexOf("/"))
      : "";

    if (spec.match(/^\.+[\w]/) && !spec.includes("/")) {
      // Python: from .foo import / from ..bar import
      const dots = spec.match(/^\.+/)![0].length;
      const rest = spec.slice(dots).replace(/\./g, "/");
      let base = dir;
      for (let i = 1; i < dots; i++) {
        const idx = base.lastIndexOf("/");
        base = idx === -1 ? "" : base.slice(0, idx);
      }
      const joined = [base, rest].filter(Boolean).join("/");
      return joined || null;
    }

    // JS/TS relative path
    const parts = (dir ? dir.split("/") : []).concat(spec.split("/"));
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/") || null;
  }

  // Absolute-from-root style used in some CODEOWNERS / aliases — skip bare pkgs
  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    return spec.replace(/^(@|~)\//, "");
  }

  return null;
}

/** Candidate repo paths to try when fetching a resolved import. */
export function importFetchCandidates(resolved: string): string[] {
  const out = new Set<string>([resolved]);
  if (!/\.[a-zA-Z0-9]+$/.test(resolved)) {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]) {
      out.add(resolved + ext);
    }
    out.add(resolved + "/index.ts");
    out.add(resolved + "/index.js");
    out.add(resolved + "/__init__.py");
  }
  return [...out];
}
