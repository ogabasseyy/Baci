import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveExportTarget } from './security-integrity-resolve-export-target';

// Resolve a package's ESM entry from its manifest: the exports map's
// import condition first (Node ignores `module` when exports exists),
// then the legacy `module` field. Throws explicitly when neither
// yields an entry instead of guessing a dist subpath.
export function packageModule(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    module?: string;
    exports?: unknown;
  };
  if (pkg.exports !== undefined) {
    const target =
      typeof pkg.exports === 'string' || Array.isArray(pkg.exports)
        ? pkg.exports
        : ((pkg.exports as Record<string, unknown>)?.['.'] ?? pkg.exports);
    const resolved = resolveExportTarget(target, ['import', 'node', 'default']);
    if (resolved !== null) {
      return resolved;
    }
    throw new Error(`Cannot resolve an ESM entry for package at ${root}`);
  }
  if (typeof pkg.module === 'string') {
    return pkg.module;
  }
  throw new Error(
    `Cannot resolve an ESM entry for package at ${root}: no exports map or module field`
  );
}
