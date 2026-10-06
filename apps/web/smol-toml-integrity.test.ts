/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageMain } from './security-integrity-load';
import { resolveRoot } from './security-integrity-resolve';

// Behavioral coverage for GHSA-r4xh-jqrq-34v2: smol-toml `parse()` spent
// quadratic time in `parseKey`, which rescanned to the end of the
// document for every dot-free key line (256k flat `k = 1` lines took
// ~10s on the old line vs ~0.2s on 1.9.0). Fixed in 1.9.0 with a
// single-pass key scanner. The parse runs in a timeout-controlled child
// process (mirroring the busboy 252-byte case) so a vulnerable
// implementation fails by timeout instead of hanging Vitest.

const LINES = 256_000;

describe('smol-toml integrity (GHSA-r4xh-jqrq-34v2)', () => {
  it('parses 256k flat keys in linear time', () => {
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
      `let doc = ''`,
      `for (let i = 0; i < ${LINES}; i++) doc += 'k' + i + ' = 1\\n'`,
      'const out = parse(doc)',
      'if (out.k0 !== 1 || out.k255999 !== 1) process.exit(2)',
    ].join('\n');
    // 1.9.0 parses this in ~0.2s; the old line needs ~10s and grows
    // quadratically, so an 8s ceiling separates them with wide margin.
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 8000,
    });
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    }).toEqual({ error: undefined, signal: null, status: 0 });
  });
});
