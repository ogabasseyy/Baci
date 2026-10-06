import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Package-root resolution for the security-integrity suites: locate the
// workspace-installed copy of a package, or an explicit unpacked-tarball
// override used to verify a test fails on the pre-fix release.

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

export function resolveRoot(
  packageName: string,
  envVar: string | undefined,
  envName: string
): string {
  if (envVar !== undefined) {
    // Verification hook only: point at an unpacked tarball to confirm
    // behavioral tests fail on pre-fix releases. Refused under CI so a
    // green run always guards the workspace-resolved dependency.
    if (process.env.CI !== undefined) {
      throw new Error(
        `${envName} is set in CI; refusing to test a non-installed copy`
      );
    }
    console.warn(`[integrity-test] testing ${packageName} from: ${envVar}`);
    return envVar;
  }
  return installedRoot(packageName);
}

export function versionAt(root: string, packageName: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (typeof pkg.version !== 'string') {
    throw new Error(`Cannot read version of ${packageName} at ${root}`);
  }
  return pkg.version;
}
