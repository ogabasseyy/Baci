/** @vitest-environment node */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Version gates for the transitive-dependency security overrides in
// `pnpm-workspace.yaml` (first patched release per advisory), plus
// behavioral mirrors of the upstream regression tests where they are
// deterministic without timing harnesses:
//
// - prosemirror-view 1.42.3 (CVE-2026-104847, paste XSS)
// - fast-copy 3.1.0 (GHSA-jggr-w7fw-pc2j, stack exhaustion)
// - compression 1.8.2 (CVE-2026-87776, premature-close leak)
// - proxy-addr 2.0.8 (CVE-2026-90711, IPv4-mapped trust bypass)
// - source-map-js 1.2.2 (CVE-2026-93749, section-offset DoS)
// - smol-toml 1.9.0 (GHSA-r4xh-jqrq-34v2, parseKey quadratic parse)

const require = createRequire(import.meta.url);

// Resolve through the exported entry point (several packages hide
// `./package.json` behind their `exports` map), then walk up to the
// owning package root.
function installedRoot(packageName: string): string {
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

function resolveRoot(
  packageName: string,
  envVar: string | undefined,
  envName: string
): string {
  if (envVar !== undefined) {
    // Verification hook only: point at an unpacked tarball to confirm
    // behavioral tests fail on pre-fix releases. Refused under CI.
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

function versionAt(root: string, packageName: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (typeof pkg.version !== 'string') {
    throw new Error(`Cannot read version of ${packageName} at ${root}`);
  }
  return pkg.version;
}

// Enumerate EVERY installed copy of a package (nested duplicates under
// the hoisted layout included), mirroring the graphql-tools suite.
function findInstalledRoots(packageName: string): string[] {
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
  let dir = dirname(fileURLToPath(import.meta.url));
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

interface ParsedVersion {
  triple: [number, number, number];
  prerelease: boolean;
}

function parseVersion(version: string): ParsedVersion {
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

function isAtLeast(
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

const PINS: [string, readonly [number, number, number]][] = [
  ['prosemirror-view', [1, 42, 3]],
  ['fast-copy', [3, 1, 0]],
  ['compression', [1, 8, 2]],
  ['proxy-addr', [2, 0, 8]],
  ['source-map-js', [1, 2, 2]],
  ['smol-toml', [1, 9, 0]],
];

type ProxyAddr = (
  req: {
    connection: { remoteAddress: string };
    headers: Record<string, string>;
  },
  trust: string | string[]
) => string;

function createReq(socketAddr: string, headers?: Record<string, string>) {
  return {
    connection: { remoteAddress: socketAddr },
    headers: headers ?? {},
  };
}

type FastCopy = (value: unknown) => unknown;

function deepNest(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) {
    value = { next: value };
  }
  return value;
}

describe('security override pins', () => {
  it.each(PINS)('resolves %s at or above its first fix', (name, floor) => {
    // Every installed copy (not just the hoisted top-level one) must
    // clear the floor: a nested older duplicate would otherwise ship
    // the vulnerability while the gate stays green.
    const roots = findInstalledRoots(name);
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      expect(
        isAtLeast(parseVersion(versionAt(root, name)), floor),
        `${name} at ${root} is below its security floor`
      ).toBe(true);
    }
  });

  it('orders prereleases below their release floor', () => {
    expect(isAtLeast(parseVersion('1.9.0-beta.1'), [1, 9, 0])).toBe(false);
    expect(isAtLeast(parseVersion('1.9.0'), [1, 9, 0])).toBe(true);
    expect(isAtLeast(parseVersion('1.9.0+build.1'), [1, 9, 0])).toBe(true);
    expect(isAtLeast(parseVersion('1.9.1-beta.1'), [1, 9, 0])).toBe(true);
  });

  it('canonicalizes IPv4-mapped trust (proxy-addr CVE-2026-90711)', () => {
    const root = resolveRoot(
      'proxy-addr',
      process.env.PROXY_ADDR_ROOT,
      'PROXY_ADDR_ROOT'
    );
    const proxyaddr = require(root) as ProxyAddr;
    // Mirrors upstream 2.0.8 IPv4-mapped cases: a mapped socket must be
    // judged by its IPv4 identity, and mapped CIDRs must match IPv4.
    expect(
      proxyaddr(
        createReq('::ffff:a00:1', {
          'x-forwarded-for': '192.168.0.1, 10.0.0.2',
        }),
        ['10.0.0.1', '10.0.0.2']
      )
    ).toBe('192.168.0.1');
    expect(
      proxyaddr(
        createReq('10.0.0.1', {
          'x-forwarded-for': '192.168.0.1, 10.0.0.2',
        }),
        ['::ffff:a00:1', '::ffff:a00:2']
      )
    ).toBe('192.168.0.1');
    expect(
      proxyaddr(
        createReq('10.0.0.1', {
          'x-forwarded-for': '192.168.0.1, 10.0.0.200',
        }),
        '::ffff:a00:2/122'
      )
    ).toBe('10.0.0.200');
  });

  it('rejects over-deep copies with MaxDepthExceededError (fast-copy)', () => {
    const root = resolveRoot(
      'fast-copy',
      process.env.FAST_COPY_ROOT,
      'FAST_COPY_ROOT'
    );
    // Resolve the CJS entry via the package's own main field rather
    // than a hardcoded dist path, so a future re-packaging cannot
    // silently break the guard.
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as { main?: string };
    const copy = (
      require(join(root, pkg.main ?? 'dist/cjs/index.cjs')) as {
        default: FastCopy;
      }
    ).default;
    let thrown: unknown;
    try {
      copy(deepNest(5000));
    } catch (error) {
      thrown = error;
    }
    // 3.1.0 throws the named, catchable error instead of an uncontrolled
    // native stack overflow.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('MaxDepthExceededError');
    expect(copy({ a: [1, 2] })).toEqual({ a: [1, 2] });
  });
});
