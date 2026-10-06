/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for CVE-2026-103923 (GHSA-238p-pmpm-9mq7):
// KaTeX's Settings/Namespace lookups read `options[prop]`,
// `schema.processor`, and namespace members without own-property guards,
// so pre-existing prototype pollution could enable `trust` and bypass
// `javascript:` URL restrictions. Fixed upstream in 0.18.2; the 0.18 line
// breaks @copilotkit/react-core's ^0.16.22 range, so 0.16.47 carries a
// backport patch (see `pnpm-workspace.yaml` patchedDependencies).

const require = createRequire(import.meta.url);

function resolveRoot(): { root: string; packageJsonPath: string } {
  const override = process.env.KATEX_ROOT;
  if (override !== undefined) {
    // Verification hook only: point at an unpacked katex tarball to
    // confirm this test fails on pre-fix releases. Refused under CI.
    if (process.env.CI !== undefined) {
      throw new Error(
        'KATEX_ROOT is set in CI; refusing to test a non-installed copy'
      );
    }
    console.warn(`[integrity-test] testing katex from: ${override}`);
    return { root: override, packageJsonPath: join(override, 'package.json') };
  }
  const packageJsonPath = require.resolve('katex/package.json');
  return { root: dirname(packageJsonPath), packageJsonPath };
}

const { root: packageRoot, packageJsonPath } = resolveRoot();

interface Katex {
  renderToString: (tex: string, options?: Record<string, unknown>) => string;
}

describe('katex integrity (CVE-2026-103923)', () => {
  it('resolves the patched 0.16.47 release', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(pkg.version).toBe('0.16.47');
  });

  // String markers cover the two readable builds only. The minified
  // bundle's single-letter identifiers are terser output, not a contract,
  // so min.js is guarded behaviorally (polluted-trust case below) instead
  // of by exact-identifier markers.
  it.each([
    'dist/katex.js',
    'dist/katex.mjs',
  ] as const)('keeps own-property guards in %s', (file) => {
    const source = readFileSync(join(packageRoot, file), 'utf8');
    // Backport-specific markers (absent 0.16.47-upstream, present patched).
    for (const marker of [
      'hasOwnProperty.call(schema, "default")',
      'hasOwnProperty.call(options, prop)',
      'hasOwnProperty.call(this.builtins, name)',
    ]) {
      expect(source).toContain(marker);
    }
  });

  it.each([
    'dist/katex.js',
    'dist/katex.min.js',
  ] as const)('ignores polluted trust in %s', (entry) => {
    // Both CJS builds carry the backport; the minified bundle is
    // unreviewable in diff view, so its behavior is asserted here.
    const katex = require(join(packageRoot, entry)) as Katex;
    const proto = Object.prototype as Record<string, unknown>;
    proto.trust = true;
    try {
      const html = katex.renderToString('\\href{javascript:alert(1)}{x}');
      expect(html).not.toContain('<a href="javascript:');
    } finally {
      delete proto.trust;
    }
    expect(proto.trust).toBeUndefined();
  });

  it('still honors an explicit trust option', () => {
    const katex = require(packageRoot) as Katex;
    const html = katex.renderToString('\\href{javascript:alert(1)}{x}', {
      trust: true,
    });
    expect(html).toContain('<a href="javascript:');
  });
});
