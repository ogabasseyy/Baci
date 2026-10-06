import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// CJS loading for the security-integrity suites: require a package from
// an explicitly resolved root through its package.json main entry.

const require = createRequire(import.meta.url);

// Resolve a CJS entry from an exports node: plain strings, condition
// maps (preferring require/node/default), and fallback arrays, with
// one extra nesting level for shapes like {node: {require: ...}}.
// Returns null when no CJS condition exists so the caller fails closed.
function resolveExportTarget(node: unknown, depth: number): string | null {
  if (typeof node === 'string') {
    return node;
  }
  if (depth > 2 || node === null || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const element of node) {
      const resolved = resolveExportTarget(element, depth + 1);
      if (resolved !== null) {
        return resolved;
      }
    }
    return null;
  }
  const conditions = node as Record<string, unknown>;
  for (const key of ['require', 'node', 'default']) {
    if (key in conditions) {
      const resolved = resolveExportTarget(conditions[key], depth + 1);
      if (resolved !== null) {
        return resolved;
      }
    }
  }
  return null;
}

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
    const target =
      typeof pkg.exports === 'string' || Array.isArray(pkg.exports)
        ? pkg.exports
        : (pkg.exports as Record<string, unknown>)?.['.'];
    const resolved = resolveExportTarget(target, 0);
    if (resolved !== null) {
      return resolved;
    }
    throw new Error(
      `Cannot resolve a CJS entry for exports-only package at ${root}`
    );
  }
  return 'index.js';
}

export function loadCjs<T>(root: string, subpath?: string): T {
  return require(join(root, subpath ?? packageMain(root))) as T;
}
