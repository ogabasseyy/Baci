/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { overrideRoots } from './security-integrity-override-roots';
import { packageMain } from './security-integrity-package-main';

// Behavioral coverage for GHSA-r4xh-jqrq-34v2: smol-toml `parse()` spent
// quadratic time in `parseKey`, which rescanned to the end of the
// document for every dot-free key line (256k flat `k = 1` lines took
// ~10s on the old line vs ~0.2s on 1.9.0). Fixed in 1.9.0 with a
// single-pass key scanner. The parse runs in a timeout-controlled child
// process (mirroring the busboy 252-byte case) so a vulnerable
// implementation fails by timeout instead of hanging Vitest.

const SMALL_LINES = 128_000;
const LARGE_LINES = 256_000;

function candidateRoots(): string[] {
  return (
    overrideRoots(process.env.SMOL_TOML_ROOTS, 'SMOL_TOML_ROOTS') ??
    findInstalledRoots('smol-toml')
  );
}

describe('smol-toml integrity (GHSA-r4xh-jqrq-34v2)', () => {
  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  // 70s budget: the 60s child ceiling (not the 10s default vitest
  // timeout) must be the backstop, so a vulnerable build fails via
  // the documented ETIMEDOUT/ratio path. Patched runs finish quickly.
  it.each(
    candidateRoots()
  )('scales linearly on large flat documents in %s', (root) => {
    // Resolve the entry through the manifest, not a hardcoded dist
    // subpath, so a future build-layout rename cannot silently detach
    // this suite from the code it guards.
    const entry = join(root, packageMain(root));
    const script = [
      `const {parse} = require(${JSON.stringify(entry)})`,
      'const ratios = []',
      'for (let round = 0; round < 5; round++) {',
      `  const sizes = round % 2 === 0 ? [${SMALL_LINES}, ${LARGE_LINES}] : [${LARGE_LINES}, ${SMALL_LINES}]`,
      '  const times = new Map()',
      '  for (const n of sizes) {',
      `    let doc = ''`,
      `    for (let i = 0; i < n; i++) doc += 'k' + i + ' = 1\\n'`,
      '    let best = Infinity',
      '    for (let i = 0; i < 3; i++) {',
      '      const start = performance.now()',
      '      const out = parse(doc)',
      '      if (out.k0 !== 1) process.exit(2)',
      '      best = Math.min(best, performance.now() - start)',
      '    }',
      '    times.set(n, best)',
      '  }',
      `  ratios.push(times.get(${LARGE_LINES}) / Math.max(times.get(${SMALL_LINES}), 1e-3))`,
      '}',
      'ratios.sort((a, b) => a - b)',
      'console.log(JSON.stringify(ratios))',
    ].join('\n');
    // Scaling gate, not an absolute cutoff: doubling the input must
    // roughly double the time (linear), not quadruple it (quadratic).
    // Best-of-3 paired measurements alternate order to reduce sensitivity
    // to transient load/GC pauses. The median ratio preserves the same
    // strict bound while rejecting one-off timing spikes. The 60s child
    // ceiling remains an anti-hang backstop for vulnerable builds.
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 60000,
    });
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    }).toEqual({ error: undefined, signal: null, status: 0 });
    const ratios = JSON.parse(result.stdout.toString()) as number[];
    const ratio = ratios[Math.floor(ratios.length / 2)];
    expect(
      ratio,
      `median scaling ratio ${ratio} exceeds 3 (samples=${ratios.join(', ')})`
    ).toBeLessThan(3);
  }, 70_000);
});
