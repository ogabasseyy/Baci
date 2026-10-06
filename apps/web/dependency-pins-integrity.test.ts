/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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

function installedVersion(packageName: string): string {
  const root = installedRoot(packageName);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (typeof pkg.version !== 'string') {
    throw new Error(`Cannot read version of ${packageName}`);
  }
  return pkg.version;
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Unexpected version: ${version}`);
  }
  return parts as [number, number, number];
}

function isAtLeast(
  actual: [number, number, number],
  minimum: readonly [number, number, number]
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== minimum[index]) {
      return actual[index] > minimum[index];
    }
  }
  return true;
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
    expect(isAtLeast(parseVersion(installedVersion(name)), floor)).toBe(true);
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
    const copy = (
      require(join(root, 'dist/cjs/index.cjs')) as { default: FastCopy }
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
