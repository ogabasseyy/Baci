import { createRequire } from 'node:module';
import type * as TypeScript from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { getFunctionSourceFrom } from './get-function-source-from';

const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6') as typeof TypeScript;

describe('getFunctionSourceFrom', () => {
  it('returns the named function declaration body slice', () => {
    const source = 'export function sampleHelper() {\n  return 1;\n}\n';
    const sourceFile = ts.createSourceFile(
      'sample.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(getFunctionSourceFrom('sampleHelper', source, sourceFile)).toContain(
      'return 1'
    );
  });

  it('throws when the function is missing', () => {
    const source = 'export function other() {}\n';
    const sourceFile = ts.createSourceFile(
      'sample.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(() =>
      getFunctionSourceFrom('missingFn', source, sourceFile)
    ).toThrow(/Unable to locate missingFn/);
  });
});
