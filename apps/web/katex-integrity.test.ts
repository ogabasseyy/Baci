/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { overrideRoots } from './security-integrity-override-roots';
import { parseVersion } from './security-integrity-parse-version';
import { isAtLeast } from './security-integrity-version-floor';

// Regression coverage for CVE-2026-103923 (GHSA-238p-pmpm-9mq7):
// KaTeX's Settings/Namespace lookups read `options[prop]`,
// `schema.processor`, and namespace members without own-property guards,
// so pre-existing prototype pollution could enable `trust` and bypass
// `javascript:` URL restrictions. Fixed upstream in 0.18.2; the 0.18 line
// breaks @copilotkit/react-core's ^0.16.22 range, so 0.16.47 carries a
// backport patch (see `pnpm-workspace.yaml` patchedDependencies).
// Every installed copy is guarded (mirroring the graphql-tools suite):
// a nested duplicate under a dependent must not escape while the
// hoisted copy passes.

const require = createRequire(import.meta.url);

function candidateRoots(): string[] {
  return (
    overrideRoots(process.env.KATEX_ROOTS, 'KATEX_ROOTS') ??
    findInstalledRoots('katex')
  );
}

interface Katex {
  renderToString: (tex: string, options?: Record<string, unknown>) => string;
}

// Runs `fn` with `Object.prototype.trust` polluted, restoring the
// prototype afterwards. defineProperty (not assignment) keeps the
// descriptor explicit; enumerable:true mirrors assignment semantics so
// the exploit shape stays faithful. Fail-closed: a pre-existing `trust`
// (worker reuse leaking pollution from another file) throws instead of
// silently masking the trust-bypass signal.
async function withPollutedTrust<T>(fn: () => T | Promise<T>): Promise<T> {
  const proto = Object.prototype as Record<string, unknown>;
  if (Object.getOwnPropertyDescriptor(proto, 'trust') !== undefined) {
    throw new Error('Object.prototype.trust already present');
  }
  Object.defineProperty(proto, 'trust', {
    value: true,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    delete proto.trust;
  }
}

describe('katex integrity (CVE-2026-103923)', () => {
  // The exploit shape pollutes Object.prototype via withPollutedTrust
  // (defineProperty + restore in finally); this double-checks no
  // pollution leaks across cases even if a worker is reused or cleanup
  // is ever skipped.
  afterEach(() => {
    expect('trust' in {}).toBe(false);
  });

  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  it.each(
    candidateRoots()
  )('resolves katex at or above the 0.16.47 floor in %s', (root) => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as {
      version?: string;
    };
    // A floor, not an exact pin: a future patched 0.16-line bump
    // satisfies the security requirement without a coupled test edit.
    // Fail-closed: an unpatched bump still fails the guard markers and
    // the polluted-trust behavior cases below.
    expect(typeof pkg.version).toBe('string');
    expect(isAtLeast(parseVersion(pkg.version as string), [0, 16, 47])).toBe(
      true
    );
  });

  // String markers cover the two readable builds only. The minified
  // bundle's single-letter identifiers are terser output, not a contract,
  // so min.js is guarded behaviorally (polluted-trust case below) instead
  // of by exact-identifier markers.
  it.each(candidateRoots())('keeps own-property guards in %s', (root) => {
    for (const file of ['dist/katex.js', 'dist/katex.mjs'] as const) {
      const source = readFileSync(join(root, file), 'utf8');
      // Backport-specific markers (absent 0.16.47-upstream, present
      // patched), matched whitespace-normalized so a secure reformat
      // cannot false-fail the gate.
      const compact = source.replace(/\s+/g, '');
      for (const marker of [
        'hasOwnProperty.call(schema,"default")',
        'hasOwnProperty.call(options,prop)',
        'hasOwnProperty.call(this.builtins,name)',
      ]) {
        expect(compact).toContain(marker);
      }
    }
  });

  it.each(candidateRoots())('ignores polluted trust in %s', async (root) => {
    for (const entry of ['dist/katex.js', 'dist/katex.min.js'] as const) {
      // Both CJS builds carry the backport; the minified bundle is
      // unreviewable in diff view, so its behavior is asserted here.
      const katex = require(join(root, entry)) as Katex;
      await withPollutedTrust(() => {
        const html = katex.renderToString('\\href{javascript:alert(1)}{x}');
        expect(html).not.toContain('<a href="javascript:');
      });
    }
    // The ESM build gets the same behavioral coverage, not just
    // string markers: a semantically broken but marker-preserving
    // .mjs (bad merge, minifier/packaging swap) must fail here.
    const esm = (await import(
      pathToFileURL(join(root, 'dist/katex.mjs')).href
    )) as Katex;
    await withPollutedTrust(() => {
      const html = esm.renderToString('\\href{javascript:alert(1)}{x}');
      expect(html).not.toContain('<a href="javascript:');
    });
    expect('trust' in {}).toBe(false);
  });

  it.each(
    candidateRoots()
  )('still honors an explicit trust option in %s', async (root) => {
    const katex = require(root) as Katex;
    const html = katex.renderToString('\\href{javascript:alert(1)}{x}', {
      trust: true,
    });
    expect(html).toContain('<a href="javascript:');
    const esm = (await import(
      pathToFileURL(join(root, 'dist/katex.mjs')).href
    )) as Katex;
    const esmHtml = esm.renderToString('\\href{javascript:alert(1)}{x}', {
      trust: true,
    });
    expect(esmHtml).toContain('<a href="javascript:');
  });
});
