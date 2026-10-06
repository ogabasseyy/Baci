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

const HERE = dirname(fileURLToPath(import.meta.url));

export function findInstalledRoots(
  packageName: string,
  startDir: string = HERE
): string[] {
  const roots = new Set<string>();
  const scan = (dir: string, depth: number, inScope: boolean): void => {
    if (depth > 8) {
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
      if (!inScope) {
        if (packageName.startsWith('@')) {
          const [scope, name] = packageName.split('/');
          if (entry.name === scope) {
            const candidate = join(full, name);
            if (existsSync(join(candidate, 'package.json'))) {
              roots.add(realpathSync(candidate));
            }
          }
        } else if (entry.name === packageName) {
          if (existsSync(join(full, 'package.json'))) {
            roots.add(realpathSync(full));
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
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      scan(candidate, 0, false);
    }
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return [...roots];
}
