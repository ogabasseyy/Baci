import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function versionAt(root: string, packageName: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (typeof pkg.version !== 'string') {
    throw new Error(`Cannot read version of ${packageName} at ${root}`);
  }
  return pkg.version;
}
