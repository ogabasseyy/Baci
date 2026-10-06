import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// CJS loading for the security-integrity suites: require a package from
// an explicitly resolved root through its package.json main entry.

const require = createRequire(import.meta.url);

export function packageMain(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    main?: string;
  };
  return pkg.main ?? 'index.js';
}

export function loadCjs<T>(root: string, subpath?: string): T {
  return require(join(root, subpath ?? packageMain(root))) as T;
}
