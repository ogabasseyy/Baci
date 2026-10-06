import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve through the exported entry point (several packages hide
// `./package.json` behind their `exports` map), then walk up to the
// owning package root. Resolution starts from `fromDir` when given, so
// suites verifying an unpacked-tarball override resolve its siblings
// from the same root instead of mixing runtimes. The result is
// canonicalized like the scanner's, so both helpers name the same
// logical install identically.
export function installedRoot(packageName: string, fromDir?: string): string {
  const resolver =
    fromDir === undefined
      ? require
      : createRequire(join(fromDir, 'package.json'));
  let dir = dirname(resolver.resolve(packageName));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: string };
      if (pkg.name === packageName) {
        return realpathSync(dir);
      }
    } catch {
      // Keep walking up.
    }
    dir = dirname(dir);
  }
  throw new Error(`Cannot locate package root for ${packageName}`);
}
