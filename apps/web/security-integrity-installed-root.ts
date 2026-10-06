import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve through the exported entry point (several packages hide
// `./package.json` behind their `exports` map), then walk up to the
// owning package root.
export function installedRoot(packageName: string): string {
  let dir = dirname(require.resolve(packageName));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: string };
      if (pkg.name === packageName) {
        return dir;
      }
    } catch {
      // Keep walking up.
    }
    dir = dirname(dir);
  }
  throw new Error(`Cannot locate package root for ${packageName}`);
}
