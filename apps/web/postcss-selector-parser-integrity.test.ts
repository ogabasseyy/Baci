/** @vitest-environment node */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageMain } from './security-integrity-load';
import { resolveRoot, versionAt } from './security-integrity-resolve';
import { isAtLeast, parseVersion } from './security-integrity-version';

// Regression coverage for CVE-2026-104844 (GHSA-rj75-hqrm-r3gf):
// `postcss-selector-parser` had quadratic complexity in flat selector
// parsing (per-index `indexOf` scans over class/id index arrays), allowing
// CPU exhaustion on attacker-supplied selectors. Fixed upstream in 7.1.6;
// the 7.x line breaks @tailwindcss/typography's exact 6.0.10 dependency,
// so 6.0.10 carries a backport patch (see `pnpm-workspace.yaml`
// patchedDependencies). The guard asserts the Set-based membership code
// is present, plus a timeout-controlled behavioral case that fails on
// the actual pre-fix CPU-exhaustion condition.

const require = createRequire(import.meta.url);

function packageRoot(): string {
  return resolveRoot(
    'postcss-selector-parser',
    process.env.PSP_ROOT,
    'PSP_ROOT'
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

const FLAT_CLASSES = 300_000;

describe('postcss-selector-parser integrity (CVE-2026-104844)', () => {
  it('resolves postcss-selector-parser at or above the 6.0.10 floor', () => {
    const root = packageRoot();
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

  it('keeps the linear-time membership backport applied', () => {
    const source = readFileSync(join(packageRoot(), 'dist/parser.js'), 'utf8');
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

  it('still parses flat class/id selectors correctly', () => {
    const parser = require(packageRoot()) as () => Parser;
    const flat = `.a${'.b'.repeat(50)}#c`;
    expect(parser().processSync(flat)).toBe(flat);
    const ast = parser().astSync(flat);
    const classNodes = (ast.first?.nodes ?? []).filter(
      (node) => node.type === 'class'
    );
    expect(classNodes.length).toBe(51);
    expect(ast.first?.nodes?.some((node) => node.type === 'id')).toBe(true);
  });

  it('parses 300k flat selectors in linear time', () => {
    const root = packageRoot();
    const entry = join(root, packageMain(root));
    const script = [
      `const parser = require(${JSON.stringify(entry)})`,
      `const flat = '.a' + '.b'.repeat(${FLAT_CLASSES}) + '#c'`,
      'const out = parser().processSync(flat)',
      'if (out !== flat) process.exit(2)',
    ].join('\n');
    // Patched 6.0.10 parses this in ~0.2s; pristine 6.0.10 needs ~25s
    // (4x per input doubling), so an 8s ceiling separates the fixed
    // membership path from the quadratic one with wide margin. The
    // parse runs in a child process so a vulnerable implementation
    // fails by timeout instead of hanging Vitest.
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
