/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { overrideRoots } from './security-integrity-override-roots';
import { packageMain } from './security-integrity-package-main';
import { parseVersion } from './security-integrity-parse-version';
import { versionAt } from './security-integrity-version-at';
import { isAtLeast } from './security-integrity-version-floor';

// Regression coverage for CVE-2026-104844 (GHSA-rj75-hqrm-r3gf):
// `postcss-selector-parser` had quadratic complexity in flat selector
// parsing (per-index `indexOf` scans over class/id index arrays), allowing
// CPU exhaustion on attacker-supplied selectors. Fixed upstream in 7.1.6;
// the 7.x line breaks @tailwindcss/typography's exact 6.0.10 dependency,
// so 6.0.10 carries a backport patch (see `pnpm-workspace.yaml`
// patchedDependencies). The guard asserts the Set-based membership code
// is present, plus a timeout-controlled behavioral case that fails on
// the actual pre-fix CPU-exhaustion condition. Every installed copy is
// guarded (mirroring the graphql-tools suite): a nested pristine
// duplicate under a dependent must not escape while the hoisted copy
// passes.

const require = createRequire(import.meta.url);

function candidateRoots(): string[] {
  return (
    overrideRoots(process.env.PSP_ROOTS, 'PSP_ROOTS') ??
    findInstalledRoots('postcss-selector-parser')
  );
}

interface SelectorNode {
  type: string;
  value: string;
}

interface Selector {
  nodes?: SelectorNode[];
}

interface Parser {
  astSync: (selector: string) => { first?: Selector };
  processSync: (selector: string) => string;
}

const SMALL_FLAT_CLASSES = 100_000;
const LARGE_FLAT_CLASSES = 200_000;

describe('postcss-selector-parser integrity (CVE-2026-104844)', () => {
  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  it.each(
    candidateRoots()
  )('resolves postcss-selector-parser at or above the 6.0.10 floor in %s', (root) => {
    // A floor, like the katex suite: a future patched 6.0.x bump must
    // not fail this gate. Fail-closed: an unpatched bump still fails
    // the backport markers and the linear-time behavior case.
    expect(
      isAtLeast(
        parseVersion(versionAt(root, 'postcss-selector-parser')),
        [6, 0, 10]
      )
    ).toBe(true);
  });

  it.each(
    candidateRoots()
  )('keeps the linear-time membership backport applied in %s', (root) => {
    const source = readFileSync(join(root, 'dist/parser.js'), 'utf8');
    expect(source).toContain('var classIndexes = new Set(hasClass);');
    expect(source).toContain('var idIndexes = new Set(hasId);');
    expect(source).toContain('if (classIndexes.has(ind)) {');
    expect(source).toContain('} else if (idIndexes.has(ind)) {');
    // Negative markers run against comment-stripped code so a future
    // upstream comment mentioning indexOf cannot false-fail the suite.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('hasClass.indexOf(ind)');
    expect(codeOnly).not.toContain('hasId.indexOf(ind)');
  });

  it.each(
    candidateRoots()
  )('still parses flat class/id selectors correctly in %s', (root) => {
    const parser = require(root) as () => Parser;
    const flat = `.a${'.b'.repeat(50)}#c`;
    expect(parser().processSync(flat)).toBe(flat);
    const ast = parser().astSync(flat);
    const classNodes = (ast.first?.nodes ?? []).filter(
      (node) => node.type === 'class'
    );
    expect(classNodes.length).toBe(51);
    expect(ast.first?.nodes?.some((node) => node.type === 'id')).toBe(true);
  });

  it.each(
    candidateRoots()
  )('scales linearly on large flat selectors in %s', (root) => {
    const entry = join(root, packageMain(root));
    const script = [
      `const parser = require(${JSON.stringify(entry)})`,
      'const times = []',
      `for (const n of [${SMALL_FLAT_CLASSES}, ${LARGE_FLAT_CLASSES}]) {`,
      `  const flat = '.a' + '.b'.repeat(n) + '#c'`,
      '  let best = Infinity',
      '  for (let i = 0; i < 3; i++) {',
      '    const start = Date.now()',
      '    const out = parser().processSync(flat)',
      '    if (out !== flat) process.exit(2)',
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
    // patched ~2.2x, pristine ~4x at these sizes. The 60s child ceiling
    // is an anti-hang backstop only (patched finishes in ~1s).
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
