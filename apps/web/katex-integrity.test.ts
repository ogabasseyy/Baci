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

const DIST_FILES = [
  'dist/katex.js',
  'dist/katex.mjs',
  'dist/katex.min.js',
] as const;

describe('katex integrity (CVE-2026-103923)', () => {
  it('resolves the patched 0.16.47 release', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(pkg.version).toBe('0.16.47');
  });

  it.each(DIST_FILES)('keeps own-property guards in %s', (file) => {
    const source = readFileSync(join(packageRoot, file), 'utf8');
    // Backport-specific markers (absent 0.16.47-upstream, present patched).
    const markers =
      file === 'dist/katex.min.js'
        ? [
            'hasOwnProperty.call(e,"default")',
            'hasOwnProperty.call(r,t)',
            'hasOwnProperty.call(this.builtins,e)',
          ]
        : [
            'hasOwnProperty.call(schema, "default")',
            'hasOwnProperty.call(options, prop)',
            'hasOwnProperty.call(this.builtins, name)',
          ];
    for (const marker of markers) {
      expect(source).toContain(marker);
    }
  });

  it('ignores polluted trust when rendering untrusted hrefs', () => {
    const katex = require(packageRoot) as Katex;
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
