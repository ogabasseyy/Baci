import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// CJS loading for the security-integrity suites: require a package from
// an explicitly resolved root through its package.json main entry.

const require = createRequire(import.meta.url);

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
    const dot =
      typeof pkg.exports === 'string'
        ? pkg.exports
        : (pkg.exports as Record<string, unknown>)?.['.'];
    if (typeof dot === 'string') {
      return dot;
    }
    const conditions = dot as Record<string, unknown> | undefined;
    for (const key of ['require', 'node', 'default']) {
      if (typeof conditions?.[key] === 'string') {
        return conditions[key] as string;
      }
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
