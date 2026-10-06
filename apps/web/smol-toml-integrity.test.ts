/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageMain } from './security-integrity-package-main';
import { resolveRoot } from './security-integrity-resolve-root';

// Behavioral coverage for GHSA-r4xh-jqrq-34v2: smol-toml `parse()` spent
// quadratic time in `parseKey`, which rescanned to the end of the
// document for every dot-free key line (256k flat `k = 1` lines took
// ~10s on the old line vs ~0.2s on 1.9.0). Fixed in 1.9.0 with a
// single-pass key scanner. The parse runs in a timeout-controlled child
// process (mirroring the busboy 252-byte case) so a vulnerable
// implementation fails by timeout instead of hanging Vitest.

const SMALL_LINES = 128_000;
const LARGE_LINES = 256_000;

describe('smol-toml integrity (GHSA-r4xh-jqrq-34v2)', () => {
  it('scales linearly on large flat documents', () => {
    const root = resolveRoot(
      'smol-toml',
      process.env.SMOL_TOML_ROOT,
      'SMOL_TOML_ROOT'
    );
    // Resolve the entry through the manifest, not a hardcoded dist
    // subpath, so a future build-layout rename cannot silently detach
    // this suite from the code it guards.
    const entry = join(root, packageMain(root));
    const script = [
      `const {parse} = require(${JSON.stringify(entry)})`,
      'const times = []',
      `for (const n of [${SMALL_LINES}, ${LARGE_LINES}]) {`,
      `  let doc = ''`,
      `  for (let i = 0; i < n; i++) doc += 'k' + i + ' = 1\\n'`,
      '  let best = Infinity',
      '  for (let i = 0; i < 3; i++) {',
      '    const start = Date.now()',
      '    const out = parse(doc)',
      '    if (out.k0 !== 1) process.exit(2)',
      '    best = Math.min(best, Date.now() - start)',
      '  }',
      '  times.push(best)',
      '}',
      'console.log(JSON.stringify(times))',
    ].join('\n');
    // Scaling gate, not an absolute cutoff: doubling the input must
    // roughly double the time (linear), not quadruple it (quadratic).
    // Best-of-3 per size shrugs off GC pauses; the ratio is
    // runner-speed independent, so slow CI cannot flake it. Measured:
    // 1.9.0 ~2.0x, old line ~4.9x. The 60s child ceiling is an
    // anti-hang backstop only (1.9.0 finishes in ~1s).
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 60000,
    });
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    }).toEqual({ error: undefined, signal: null, status: 0 });
    const [small, large] = JSON.parse(result.stdout.toString()) as [
      number,
      number,
    ];
    expect(large / Math.max(small, 1)).toBeLessThan(3);
  });
});
