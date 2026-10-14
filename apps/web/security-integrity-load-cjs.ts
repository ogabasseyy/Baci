import { createRequire } from 'node:module';
import { join } from 'node:path';
import { packageMain } from './security-integrity-package-main';

const require = createRequire(import.meta.url);

export function loadCjs<T>(root: string, subpath?: string): T {
  return require(join(root, subpath ?? packageMain(root))) as T;
}
