import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBenignFsError } from './security-integrity-benign-fs-error';
import { expandWorkspaces } from './security-integrity-workspace-globs';

// Enumerate EVERY installed copy of a package: the ancestor chain's
// nested duplicates, the pnpm virtual store
// (`node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`), AND every
// sibling workspace's node_modules (from the `packages:` globs), so a
// non-hoisted, doubly-nested, or sibling-app duplicate cannot stay
// vulnerable while the version gate stays green. Scoped-aware,
// realpath-deduped, and bounded at the enclosing repo root so worktree
// checkouts never scan a parent checkout's node_modules.
//
// Soundness bound (fail-closed, not silent): recursion past depth 8,
// an upward walk past 12 levels, an unreadable or keyless
// pnpm-workspace.yaml, and any non-ENOENT/ENOTDIR filesystem error all
// throw, so a pathological layout fails the gate instead of passing on
// a partial list. Depth 8 covers realistic pnpm hoisted and
// virtual-store layouts.

const HERE = dirname(fileURLToPath(import.meta.url));

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
    } catch (error) {
      // Only a dangling symlink or an install-time race between the
      // existsSync check and resolution is safe to skip: an
      // unresolvable candidate cannot be loaded by Node either. Any
      // other resolution failure throws fail-closed.
      if (!isBenignFsError(error)) {
        throw error;
      }
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
    } catch (error) {
      if (isBenignFsError(error)) {
        return;
      }
      throw error;
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
        } catch (error) {
          if (!isBenignFsError(error)) {
            throw error;
          }
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
        // Depth increments here too, so the depth-8 cap bounds every
        // descent shape, not just node_modules nesting.
        scan(full, depth + 1, true);
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
    } catch (error) {
      if (!isBenignFsError(error)) {
        throw error;
      }
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
