/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { loadCjs } from './security-integrity-load';
import { resolveRoot, versionAt } from './security-integrity-resolve';
import { findInstalledRoots } from './security-integrity-scan';
import { isAtLeast, parseVersion } from './security-integrity-version';

// Version gates for the transitive-dependency security overrides in
// `pnpm-workspace.yaml` (first patched release per advisory), plus
// behavioral mirrors of the upstream regression tests where they fit
// this file's scope. Larger behavioral suites live in their own files:
// prosemirror, compression, source-map, and smol-toml integrity tests.
//
// - prosemirror-view 1.42.3 (CVE-2026-104847, paste XSS)
// - fast-copy 3.1.0 (GHSA-jggr-w7fw-pc2j, stack exhaustion)
// - compression 1.8.2 (CVE-2026-87776, premature-close leak)
// - proxy-addr 2.0.8 (CVE-2026-90711, IPv4-mapped trust bypass)
// - source-map-js 1.2.2 (CVE-2026-93749, section-offset DoS)
// - smol-toml 1.9.0 (GHSA-r4xh-jqrq-34v2, parseKey quadratic parse)

const PINS: [string, readonly [number, number, number]][] = [
  ['prosemirror-view', [1, 42, 3]],
  ['prosemirror-model', [1, 25, 11]],
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
    const proxyaddr = loadCjs<ProxyAddr>(root);
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
    // Short-prefix regression case (GHSA-jqcg-44mw-7w3h): 2.0.7 trusted
    // ALL IPv4 under '::ffff:10.0.0.0/8'; 2.0.8 refuses prefixes below /96.
    expect(
      proxyaddr(
        createReq('127.0.0.1', { 'x-forwarded-for': '9.9.9.9' }),
        '::ffff:10.0.0.0/8'
      )
    ).toBe('127.0.0.1');
  });

  it('rejects over-deep copies with MaxDepthExceededError (fast-copy)', () => {
    const root = resolveRoot(
      'fast-copy',
      process.env.FAST_COPY_ROOT,
      'FAST_COPY_ROOT'
    );
    const copy = loadCjs<{ default: FastCopy }>(root).default;
    let thrown: unknown;
    try {
      copy(deepNest(5000));
    } catch (error) {
      thrown = error;
    }
    // Per the fast-copy 3.1.0 CHANGELOG (backport of the 4.1.0 fix): a
    // `maxDepth` option defaulting to 1000 bounds traversal, and nesting
    // past it throws the named `MaxDepthExceededError` (extending
    // RangeError) instead of an uncontrolled native stack overflow.
    // Verified: 3.0.2 throws RangeError 'Maximum call stack size exceeded'.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('MaxDepthExceededError');
    expect((thrown as Error).message).toMatch(/maximum copy depth/i);
    expect(copy({ a: [1, 2] })).toEqual({ a: [1, 2] });
  });
});
