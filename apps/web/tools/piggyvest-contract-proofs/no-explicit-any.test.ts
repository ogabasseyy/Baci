import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Biome's `noExplicitAny` is switched off for `*.test.ts` files by the root
 * biome.json, so a test could use `any` without any lint noticing. The harness
 * holds its test files to the same standard as its sources: no explicit `any`.
 */

const ANY_TYPE =
  /(?::\s*any\b|\bas\s+any\b|<any\b|\bany\s*\[\]|,\s*any\s*>|\bany\s*>|=>\s*any\b)/;

/** Source with comments and string/template literal contents blanked out. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

function anyUses(source: string): string[] {
  return codeOnly(source)
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => ANY_TYPE.test(line))
    .map(({ line, number }) => `line ${number}: ${line}`);
}

describe('anyUses (the scanner itself)', () => {
  it('finds every spelling of an explicit any', () => {
    for (const code of [
      'const x: any = 1;',
      'const y = value as any;',
      'const z = <any>value;',
      'function f(items: any[]) {}',
      'const m: Map<string, any> = new Map();',
      'type T = Promise<any>;',
      'const g = (d: Foo): any => d;',
    ]) {
      expect(anyUses(code), code).toHaveLength(1);
    }
  });

  it('ignores the word in comments, strings and ordinary identifiers', () => {
    for (const code of [
      '// any answer is fine',
      '/* an: any thing */',
      "const note = 'type: any';",
      'const many = company + anything;',
      'expect(anyUses).toBeDefined();',
    ]) {
      expect(anyUses(code), code).toEqual([]);
    }
  });
});

describe('the harness uses no explicit any, tests included', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // This file holds the patterns and fixtures themselves; its own tests cover it.
  const files = readdirSync(dir).filter(
    (name) => name.endsWith('.ts') && name !== 'no-explicit-any.test.ts'
  );

  it('scans every harness file', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(files)('%s has no explicit any', (name) => {
    expect(anyUses(readFileSync(path.join(dir, name), 'utf8'))).toEqual([]);
  });
});
