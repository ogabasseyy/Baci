/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { overrideRoots } from './security-integrity-override-roots';
import { packageMain } from './security-integrity-package-main';
import { parseVersion } from './security-integrity-parse-version';
import { stripComments } from './security-integrity-strip-comments';
import { versionAt } from './security-integrity-version-at';
import { isAtLeast } from './security-integrity-version-floor';

// GHSA-rj75-hqrm-r3gf and the follow-up flat-selector DoS advisory are
// fixed upstream in 6.1.5. Guard all installed copies and retain the existing
// parser behavior and linear-time Set membership tests after retiring the backport.

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
  )('resolves postcss-selector-parser at or above the 6.1.5 floor in %s', (root) => {
    // A floor, like the katex suite: a future patched 6.0.x bump must
    // not fail this gate. Fail-closed: an unpatched bump still fails
    // the backport markers and the linear-time behavior case.
    expect(
      isAtLeast(
        parseVersion(versionAt(root, 'postcss-selector-parser')),
        [6, 1, 5]
      )
    ).toBe(true);
  });

  it.each(
    candidateRoots()
  )('keeps the linear-time membership backport applied in %s', (root) => {
    // Manifest-anchored marker source: the parser build must live next
    // to the manifest-resolved entry, so a build-layout rename fails
    // closed here (readFileSync throws) instead of testing a stale
    // hardcoded path while the entry-driven gates move on.
    const markerFile = join(root, dirname(packageMain(root)), 'parser.js');
    const source = readFileSync(markerFile, 'utf8');
    // Markers match whitespace-normalized code, not exact source text,
    // so a secure reformat (spacing, line breaks) that preserves the
    // Set-based membership still passes. Identifier-level renames
    // intentionally still fail: they change the backport shape the
    // patch pins and deserve re-review.
    const compact = source.replace(/\s+/g, '');
    expect(compact).toContain('newSet(hasClass)');
    expect(compact).toContain('newSet(hasId)');
    expect(compact).toContain('classIndexes.has(ind)');
    expect(compact).toContain('idIndexes.has(ind)');
    // Negative markers run against comment-stripped code so a future
    // upstream comment mentioning indexOf cannot false-fail the suite.
    // The stripper is conservative (never strips inside strings, URLs,
    // or division-adjacent tails), so real code is never hidden.
    const codeOnly = stripComments(source);
    expect(codeOnly).not.toContain('hasClass.indexOf(ind)');
    expect(codeOnly).not.toContain('hasId.indexOf(ind)');
  });

  it.each(
    candidateRoots()
  )('still parses flat class/id selectors correctly in %s', (root) => {
    // Manifest-resolved entry like the katex suite: no ambient
    // main-field resolution, so all three gates move together on a
    // build-layout rename.
    const parser = require(join(root, packageMain(root))) as () => Parser;
    const flat = `.a${'.b'.repeat(50)}#c`;
    expect(parser().processSync(flat)).toBe(flat);
    const ast = parser().astSync(flat);
    const classNodes = (ast.first?.nodes ?? []).filter(
      (node) => node.type === 'class'
    );
    expect(classNodes.length).toBe(51);
    expect(ast.first?.nodes?.some((node) => node.type === 'id')).toBe(true);
  });

  // 70s budget: the 60s child ceiling (not the 10s default vitest
  // timeout) must be the backstop, so a vulnerable build fails via
  // the documented ETIMEDOUT/ratio path. Patched runs finish in ~1s.
  it.each(
    candidateRoots()
  )('scales linearly on large flat selectors in %s', (root) => {
    const entry = join(root, packageMain(root));
    const script = [
      `const parser = require(${JSON.stringify(entry)})`,
      `const sizes = [${SMALL_FLAT_CLASSES}, ${LARGE_FLAT_CLASSES}]`,
      `const inputs = new Map(sizes.map(n => [n, '.a' + '.b'.repeat(n) + '#c']))`,
      'parser().processSync(inputs.get(sizes[0]))',
      'const ratios = []',
      'for (let round = 0; round < 5; round++) {',
      '  const times = new Map()',
      '  const order = round % 2 === 0 ? sizes : [...sizes].reverse()',
      '  for (const n of order) {',
      '    const start = process.cpuUsage()',
      '    const out = parser().processSync(inputs.get(n))',
      '    if (out !== inputs.get(n)) process.exit(2)',
      '    const cpu = process.cpuUsage(start)',
      '    times.set(n, cpu.user + cpu.system)',
      '  }',
      '  ratios.push(times.get(sizes[1]) / Math.max(times.get(sizes[0]), 1))',
      '}',
      'ratios.sort((a, b) => a - b)',
      'console.log(JSON.stringify(ratios))',
    ].join('\n');
    // Scaling gate, not an absolute cutoff: doubling the input must
    // roughly double the time (linear), not quadruple it (quadratic).
    // Paired CPU measurements alternate order so unrelated work does not
    // inflate wall-clock samples. The median retains the strict <3 bound;
    // the 60s wall-clock child ceiling remains an anti-hang backstop.
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
      `median CPU scaling ratio ${ratio} exceeds 3 (samples=${ratios.join(', ')})`
    ).toBeLessThan(3);
  }, 70_000);
});
