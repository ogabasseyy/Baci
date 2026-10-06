import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enumerate EVERY installed copy of a package: the hoisted layout's
// nested duplicates AND the pnpm virtual store
// (`node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`), so a
// non-hoisted or doubly-nested duplicate cannot stay vulnerable while
// the version gate stays green. Scoped-aware, realpath-deduped, and
// bounded at the enclosing repo root so worktree checkouts never scan a
// parent checkout's node_modules.
//
// Soundness bound (fail-closed, not silent): recursion past depth 8
// and an upward walk past 12 levels both throw, so a pathological
// layout fails the gate instead of passing on a partial list. Depth 8
// covers realistic pnpm hoisted and virtual-store layouts.

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
  let dir = startDir;
  let capped = true;
  for (let level = 0; level < 12; level += 1) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      scan(candidate, 0, false);
    }
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
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
  if (truncated) {
    throw new Error(
      `findInstalledRoots(${packageName}) hit the depth-8 recursion cap; results may be incomplete`
    );
  }
  return [...roots];
}
