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
// fixed upstream in 6.1.5. Guard all installed copies, parser behavior, and
// the offset-scan regression after retiring the backport.

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

describe('postcss-selector-parser integrity (CVE-2026-104844)', () => {
  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  it.each(
    candidateRoots()
  )('resolves postcss-selector-parser at or above the 6.1.5 floor in %s', (root) => {
    // A floor permits newer releases while rejecting versions before the fix.
    expect(
      isAtLeast(
        parseVersion(versionAt(root, 'postcss-selector-parser')),
        [6, 1, 5]
      )
    ).toBe(true);
  });

  it.each(
    candidateRoots()
  )('keeps the fixed Set-based membership in %s', (root) => {
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

  // Count offset-array scans directly in an isolated process. This checks the
  // vulnerability mechanism without relying on shared-runner timing.
  it.each(
    candidateRoots()
  )('avoids scanning class and ID offsets for each flat selector node in %s', (root) => {
    const entry = join(root, packageMain(root));
    const script = [
      `const parser = require(${JSON.stringify(entry)})`,
      'const count = 256',
      "const flat = '.a'.repeat(count) + '#b'.repeat(count)",
      "const methods = ['indexOf', 'includes', 'find', 'findIndex']",
      'const originals = Object.fromEntries(methods.map(name => [name, Array.prototype[name]]))',
      'const scans = { class: 0, id: 0 }',
      'const kinds = new WeakMap()',
      'function kindOf(array) {',
      '  if (!Array.isArray(array)) return null',
      '  if (kinds.has(array)) return kinds.get(array)',
      '  if (array.length === count) {',
      '    for (const [name, start] of [["class", 0], ["id", 2 * count]]) {',
      '      if (array[0] !== start || array[count - 1] !== start + 2 * (count - 1)) continue',
      '      let matches = true',
      '      for (let i = 0; i < count; i++) if (array[i] !== start + 2 * i) { matches = false; break }',
      '      if (matches) { kinds.set(array, name); return name }',
      '    }',
      '  }',
      '  return null',
      '}',
      'let out',
      'try {',
      '  for (const name of methods) Array.prototype[name] = function (...args) {',
      '    const kind = kindOf(this)',
      '    if (kind) scans[kind]++',
      '    return Reflect.apply(originals[name], this, args)',
      '  }',
      '  Array.from({ length: count }, (_, i) => 2 * i).indexOf(-1)',
      '  Array.from({ length: count }, (_, i) => 2 * (count + i)).indexOf(-1)',
      '  if (scans.class !== 1 || scans.id !== 1) throw new Error("scan detector self-check failed")',
      '  scans.class = 0; scans.id = 0',
      '  out = parser().processSync(flat)',
      '} finally { for (const name of methods) Array.prototype[name] = originals[name] }',
      'if (out !== flat) process.exit(2)',
      'console.log(JSON.stringify(scans))',
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 10000,
    });
    expect({
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    }).toEqual({ error: undefined, signal: null, status: 0 });
    expect(JSON.parse(result.stdout.toString())).toEqual({ class: 0, id: 0 });
  }, 20_000);
});
