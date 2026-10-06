import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enumerate EVERY installed copy of a package: the ancestor chain's
// nested duplicates, the pnpm virtual store
// (`node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`), AND every
// sibling workspace's node_modules (from the `packages:` globs), so a
// non-hoisted, doubly-nested, or sibling-app duplicate cannot stay
// vulnerable while the version gate stays green. Scoped-aware,
// realpath-deduped, and bounded at the enclosing repo root so worktree
// checkouts never scan a parent checkout's node_modules.
//
// Soundness bound (fail-closed, not silent): recursion past depth 8
// and an upward walk past 12 levels both throw, so a pathological
// layout fails the gate instead of passing on a partial list. Depth 8
// covers realistic pnpm hoisted and virtual-store layouts.

const HERE = dirname(fileURLToPath(import.meta.url));

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal `packages:` reader for pnpm-workspace.yaml: block lists and
// flow lists only (no YAML dependency for a test helper).
function readPackageGlobs(workspaceRoot: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    /^packages:\s*(\[.*\])?\s*(#.*)?$/.test(line)
  );
  if (start === -1) {
    return [];
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
// staying inside the workspace root.
function expandWorkspaces(workspaceRoot: string): string[] {
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
    } catch {
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
    // green.
    if (glob.includes('..') || isAbsolute(glob)) {
      throw new Error(
        `findInstalledRoots: workspace glob escapes the root: ${glob}`
      );
    }
    if (glob.includes('**') || glob.includes('?') || glob.includes('{')) {
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

export function findInstalledRoots(
  packageName: string,
  startDir: string = HERE
): string[] {
  const roots = new Set<string>();
  // A bare '@scope' query (no slash) matches nothing instead of throwing
  // on join(full, undefined): the helper stays total for any input.
  const scopeParts = packageName.startsWith('@') ? packageName.split('/') : [];
  const scoped =
    scopeParts.length === 2
      ? { scope: scopeParts[0], name: scopeParts[1] }
      : null;
  const matchable = scoped !== null || !packageName.startsWith('@');
  let truncated = false;
  const addRoot = (candidate: string): void => {
    try {
      roots.add(realpathSync(candidate));
    } catch {
      // Dangling symlink, permission error, or install-time race
      // between the existsSync check and resolution: skip this
      // candidate instead of aborting the whole scan.
    }
  };
  const scan = (dir: string, depth: number, inScope: boolean): void => {
    if (depth > 8) {
      truncated = true;
      return;
    }
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.name === '.pnpm') {
        // Virtual store: each <pkg>@<version> entry carries its own
        // node_modules with the package and its private duplicates.
        let storeEntries: ReturnType<typeof readdirSync>;
        try {
          storeEntries = readdirSync(full, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const storeEntry of storeEntries) {
          if (!storeEntry.isDirectory() && !storeEntry.isSymbolicLink()) {
            continue;
          }
          const storeModules = join(full, storeEntry.name, 'node_modules');
          if (existsSync(storeModules)) {
            scan(storeModules, depth + 1, false);
          }
        }
        continue;
      }
      // Inside a scope directory only scoped queries can match: `@scope/dup`
      // is a different package from `dup`.
      if (!inScope && matchable) {
        if (scoped !== null) {
          if (entry.name === scoped.scope) {
            const candidate = join(full, scoped.name);
            if (existsSync(join(candidate, 'package.json'))) {
              addRoot(candidate);
            }
          }
        } else if (entry.name === packageName) {
          if (existsSync(join(full, 'package.json'))) {
            addRoot(full);
          }
        }
      }
      if (entry.name.startsWith('@')) {
        scan(full, depth, true);
      } else {
        const nested = join(full, 'node_modules');
        if (existsSync(nested)) {
          scan(nested, depth + 1, false);
        }
      }
    }
  };
  const scanned = new Set<string>();
  const scanModules = (modules: string): void => {
    let real: string;
    try {
      real = realpathSync(modules);
    } catch {
      return;
    }
    if (scanned.has(real)) {
      return;
    }
    scanned.add(real);
    scan(real, 0, false);
  };
  // Ancestor chain first (covers the caller's own install), then every
  // sibling workspace from the `packages:` globs: a nested duplicate
  // under a sibling app must not escape the EVERY-copy claim.
  let dir = startDir;
  let capped = true;
  let workspaceRoot: string | null = null;
  const ancestors: string[] = [];
  for (let level = 0; level < 12; level += 1) {
    ancestors.push(join(dir, 'node_modules'));
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      workspaceRoot = dir;
      capped = false;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      capped = false;
      break;
    }
    dir = parent;
  }
  // Fail closed, not silent: a truncated walk throws instead of letting
  // the EVERY-copy claim pass on a partial list. A warning in CI logs
  // would be too easy to miss for a security gate.
  if (capped) {
    throw new Error(
      `findInstalledRoots(${packageName}) hit the 12-level upward-walk cap; results may be incomplete`
    );
  }
  for (const modules of ancestors) {
    if (existsSync(modules)) {
      scanModules(modules);
    }
  }
  if (workspaceRoot !== null) {
    for (const workspace of expandWorkspaces(workspaceRoot)) {
      const modules = join(workspace, 'node_modules');
      if (existsSync(modules)) {
        scanModules(modules);
      }
    }
  }
  if (truncated) {
    throw new Error(
      `findInstalledRoots(${packageName}) hit the depth-8 recursion cap; results may be incomplete`
    );
  }
  return [...roots];
}
