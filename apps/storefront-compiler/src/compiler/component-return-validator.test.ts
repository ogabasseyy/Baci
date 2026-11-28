import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { hasNoStaticallyInvalidReactReturn } from './component-return-validator';

function checkDefaultExportFn(source: string): boolean {
  const sf = ts.createSourceFile(
    'App.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      return hasNoStaticallyInvalidReactReturn(stmt);
    }
    if (
      ts.isExportAssignment(stmt) &&
      (ts.isArrowFunction(stmt.expression) ||
        ts.isFunctionExpression(stmt.expression))
    ) {
      return hasNoStaticallyInvalidReactReturn(stmt.expression);
    }
  }
  throw new Error('No default function found');
}

describe('component-return-validator', () => {
  it('allows valid iterables, loop shadowing, and short-circuit boolean/nullish returns while rejecting non-renderable objects', () => {
    expect(checkDefaultExportFn(`export default () => new Set(['ok']);`)).toBe(
      true
    );
    expect(
      checkDefaultExportFn(`export default () => new Uint8Array([1, 2]);`)
    ).toBe(true);
    expect(checkDefaultExportFn(`export default () => false && ({});`)).toBe(
      true
    );
    expect(checkDefaultExportFn(`export default () => 'ready' || ({});`)).toBe(
      true
    );
    expect(checkDefaultExportFn(`export default () => 'ready' ?? ({});`)).toBe(
      true
    );
    expect(
      checkDefaultExportFn(
        `const item = {};\nexport default function App() { for (const item of ['ok']) { return item; } return null; }`
      )
    ).toBe(true);

    expect(checkDefaultExportFn(`export default () => ({});`)).toBe(false);
    expect(checkDefaultExportFn(`export default () => true && ({});`)).toBe(
      false
    );
    expect(checkDefaultExportFn(`export default () => new Date();`)).toBe(
      false
    );
    expect(checkDefaultExportFn(`export default () => new WeakSet();`)).toBe(
      false
    );
  });
});
