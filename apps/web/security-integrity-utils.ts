import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared helpers for the dependency security-integrity suites in this
// directory. Resolution is anchored to this file's own location, which
// lives alongside the suites, so module lookup matches every consumer.

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

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

// Enumerate EVERY installed copy of a package (nested duplicates under
// the hoisted layout included). Scoped-aware, realpath-deduped, and
// bounded at the enclosing repo root so worktree checkouts never scan a
// parent checkout's node_modules.
export function findInstalledRoots(packageName: string): string[] {
  const roots = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 8) {
      return;
    }
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (packageName.startsWith('@')) {
        const [scope, name] = packageName.split('/');
        if (entry.name === scope) {
          const candidate = join(full, name);
          if (existsSync(join(candidate, 'package.json'))) {
            roots.add(realpathSync(candidate));
          }
        }
      } else if (entry.name === packageName) {
        if (existsSync(join(full, 'package.json'))) {
          roots.add(realpathSync(full));
        }
      }
      if (entry.name.startsWith('@')) {
        scan(full, depth);
      } else {
        const nested = join(full, 'node_modules');
        if (existsSync(nested)) {
          scan(nested, depth + 1);
        }
      }
    }
  };
  let dir = HERE;
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      scan(realpathSync(candidate), 0);
    }
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return [...roots];
}

export interface ParsedVersion {
  triple: [number, number, number];
  prerelease: boolean;
}

export function parseVersion(version: string): ParsedVersion {
  // Build metadata (+build) never affects precedence; a pre-release
  // suffix (-beta.1) orders BELOW the same numeric triple and is not
  // covered by the advisory's patched-version guarantee.
  const withoutBuild = version.split('+', 1)[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Unexpected version: ${version}`);
  }
  return {
    triple: parts as [number, number, number],
    prerelease: dash !== -1,
  };
}

export function isAtLeast(
  actual: ParsedVersion,
  minimum: readonly [number, number, number]
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual.triple[index] !== minimum[index]) {
      return actual.triple[index] > minimum[index];
    }
  }
  // Equal triple: a prerelease (1.9.0-beta) is below the floor (1.9.0).
  return !actual.prerelease;
}

export function packageMain(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    main?: string;
  };
  return pkg.main ?? 'index.js';
}

export function loadCjs<T>(root: string, subpath?: string): T {
  return require(join(root, subpath ?? packageMain(root))) as T;
}
