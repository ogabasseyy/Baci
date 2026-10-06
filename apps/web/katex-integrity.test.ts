/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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

describe('katex integrity (CVE-2026-103923)', () => {
  // The exploit shape mutates Object.prototype; each case cleans up in
  // finally, and this double-checks no pollution leaks across cases even
  // if a worker is reused or cleanup is ever skipped.
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
      // Backport-specific markers (absent 0.16.47-upstream, present patched).
      for (const marker of [
        'hasOwnProperty.call(schema, "default")',
        'hasOwnProperty.call(options, prop)',
        'hasOwnProperty.call(this.builtins, name)',
      ]) {
        expect(source).toContain(marker);
      }
    }
  });

  it.each(candidateRoots())('ignores polluted trust in %s', (root) => {
    for (const entry of ['dist/katex.js', 'dist/katex.min.js'] as const) {
      // Both CJS builds carry the backport; the minified bundle is
      // unreviewable in diff view, so its behavior is asserted here.
      const katex = require(join(root, entry)) as Katex;
      const proto = Object.prototype as Record<string, unknown>;
      proto.trust = true;
      try {
        const html = katex.renderToString('\\href{javascript:alert(1)}{x}');
        expect(html).not.toContain('<a href="javascript:');
      } finally {
        delete proto.trust;
      }
      expect(proto.trust).toBeUndefined();
    }
  });

  it.each(
    candidateRoots()
  )('still honors an explicit trust option in %s', (root) => {
    const katex = require(root) as Katex;
    const html = katex.renderToString('\\href{javascript:alert(1)}{x}', {
      trust: true,
    });
    expect(html).toContain('<a href="javascript:');
  });
});
