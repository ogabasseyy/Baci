import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveExportTarget } from './security-integrity-resolve-export-target';

export function packageMain(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    main?: string;
    exports?: unknown;
  };
  if (typeof pkg.main === 'string') {
    return pkg.main;
  }
  // Exports-aware fallback for main-less packages: resolve the '.'
  // entry's CJS condition instead of blindly assuming index.js.
  if (pkg.exports !== undefined) {
    // Top-level conditional sugar ({"import": ..., "require": ...} with
    // no '.' key) resolves as a condition map over the whole object;
    // subpath-only maps still fall through to the explicit throw.
    const target =
      typeof pkg.exports === 'string' || Array.isArray(pkg.exports)
        ? pkg.exports
        : ((pkg.exports as Record<string, unknown>)?.['.'] ?? pkg.exports);
    const resolved = resolveExportTarget(target, [
      'require',
      'node',
      'default',
    ]);
    if (resolved !== null) {
      return resolved;
    }
    throw new Error(
      `Cannot resolve a CJS entry for exports-only package at ${root}`
    );
  }
  return 'index.js';
}
