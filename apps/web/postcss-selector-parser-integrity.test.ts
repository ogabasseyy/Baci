/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for CVE-2026-104844 (GHSA-rj75-hqrm-r3gf):
// `postcss-selector-parser` had quadratic complexity in flat selector
// parsing (per-index `indexOf` scans over class/id index arrays), allowing
// CPU exhaustion on attacker-supplied selectors. Fixed upstream in 7.1.6;
// the 7.x line breaks @tailwindcss/typography's exact 6.0.10 dependency,
// so 6.0.10 carries a backport patch (see `pnpm-workspace.yaml`
// patchedDependencies). The guard asserts the Set-based membership code
// is present plus a functional parse smoke test (a timing assertion
// would be flaky in CI; the code marker is the stable signal).

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('postcss-selector-parser/package.json');
const packageRoot = dirname(packageJsonPath);

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

describe('postcss-selector-parser integrity (CVE-2026-104844)', () => {
  it('resolves the patched 6.0.10 release', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(pkg.version).toBe('6.0.10');
  });

  it('keeps the linear-time membership backport applied', () => {
    const source = readFileSync(join(packageRoot, 'dist/parser.js'), 'utf8');
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
    const parser = require(packageRoot) as () => Parser;
    const flat = `.a${'.b'.repeat(50)}#c`;
    expect(parser().processSync(flat)).toBe(flat);
    const ast = parser().astSync(flat);
    const classNodes = (ast.first?.nodes ?? []).filter(
      (node) => node.type === 'class'
    );
    expect(classNodes.length).toBe(51);
    expect(ast.first?.nodes?.some((node) => node.type === 'id')).toBe(true);
  });
});
