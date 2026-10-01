import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { trustedContextIsSafe } from './analytics-delivery-trusted-context-analysis';

function analyze(source: string): boolean {
  const file = ts.createSourceFile(
    'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  let use: ts.Identifier | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === 'merchantContext' &&
      ts.isPropertyAccessExpression(node.parent)
    ) {
      use = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!use) throw new Error('fixture context use missing');
  return trustedContextIsSafe(file, use);
}

describe('trustedContextIsSafe', () => {
  it('accepts an unescaped immutable resolver result', () => {
    expect(
      analyze(
        'const merchantContext = resolve(); merchantContext.verifiedMerchantId;'
      )
    ).toBe(true);
  });

  it.each([
    'const alias = merchantContext; alias.verifiedMerchantId = input;',
    'leak(merchantContext);',
  ])('rejects %s', (attack) => {
    expect(
      analyze(
        `const merchantContext = resolve(); ${attack} merchantContext.verifiedMerchantId;`
      )
    ).toBe(false);
  });
});
