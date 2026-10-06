import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isBenignFsError } from './security-integrity-benign-fs-error';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal `packages:` reader for pnpm-workspace.yaml: block lists and
// flow lists only (no YAML dependency for a test helper). Fail-closed:
// an unreadable file or a missing `packages:` key throws instead of
// silently narrowing the scan to the ancestor chain (an explicit empty
// list like `packages: []` still means "no sibling workspaces").
function readPackageGlobs(workspaceRoot: string): string[] {
  const manifest = join(workspaceRoot, 'pnpm-workspace.yaml');
  let text: string;
  try {
    text = readFileSync(manifest, 'utf8');
  } catch {
    throw new Error(
      `findInstalledRoots: cannot read ${manifest}; refusing to scan a possibly partial list`
    );
  }
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    /^packages:\s*(\[.*\])?\s*(#.*)?$/.test(line)
  );
  if (start === -1) {
    throw new Error(
      `findInstalledRoots: ${manifest} has no packages: key; refusing to scan a possibly partial list`
    );
  }
  const inline = lines[start].match(/^packages:\s*\[(.*)\]/);
  if (inline) {
    return inline[1]
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter((item) => item.length > 0);
  }
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#/.test(line) || line.trim() === '') {
      continue;
    }
    if (/^[^\s]/.test(line)) {
      break;
    }
    const item = line.match(/^\s*-\s*(.+?)\s*(#.*)?$/);
    if (item) {
      globs.push(item[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return globs;
}

// Expand workspace globs (`apps/*`, literal paths) to directories,
// staying inside the workspace root. Returned directories may not
// exist; callers check before scanning.
export function expandWorkspaces(workspaceRoot: string): string[] {
  const results: string[] = [];
  const expand = (base: string, segments: string[]): void => {
    if (segments.length === 0) {
      results.push(base);
      return;
    }
    const [head, ...tail] = segments;
    if (!head.includes('*')) {
      expand(join(base, head), tail);
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch (error) {
      if (!isBenignFsError(error)) {
        throw error;
      }
      return;
    }
    const pattern = new RegExp(
      `^${head.split('*').map(escapeRegExp).join('.*')}$`
    );
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) {
        continue;
      }
      if (pattern.test(entry)) {
        expand(join(base, entry), tail);
      }
    }
  };
  for (const glob of readPackageGlobs(workspaceRoot)) {
    // Fail closed on anything that would silently narrow the scan:
    // out-of-root globs and unsupported syntax both throw instead of
    // skipping a sibling workspace while the EVERY-copy claim reports
    // green. The parent check is segment-based, so a directory merely
    // named `foo..bar` still scans; backslashes are rejected outright
    // (pnpm documents forward slashes only) instead of being
    // interpreted as separators.
    if (
      glob.split('/').some((segment) => segment === '..') ||
      isAbsolute(glob)
    ) {
      throw new Error(
        `findInstalledRoots: workspace glob escapes the root: ${glob}`
      );
    }
    if (
      glob.includes('\\') ||
      glob.includes('**') ||
      glob.includes('?') ||
      glob.includes('{')
    ) {
      throw new Error(
        `findInstalledRoots: unsupported workspace glob syntax: ${glob}`
      );
    }
    expand(
      workspaceRoot,
      glob.split('/').filter((s) => s.length > 0 && s !== '.')
    );
  }
  return results;
}
