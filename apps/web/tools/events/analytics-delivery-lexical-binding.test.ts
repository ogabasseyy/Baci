import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { resolveLexicalBinding } from './analytics-delivery-lexical-binding';

function importedTarget(source: string) {
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
      node.text === 'target' &&
      ts.isCallExpression(node.parent)
    ) {
      use = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!use) throw new Error('fixture identifier missing');
  return { file, use };
}

describe('resolveLexicalBinding', () => {
  it('selects the nearest enclosing declaration', () => {
    const file = ts.createSourceFile(
      'fixture.ts',
      "const key = 'outer'; { const key = 'inner'; use(key); }",
      ts.ScriptTarget.Latest,
      true
    );
    let use: ts.Identifier | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isIdentifier(node) &&
        node.text === 'key' &&
        ts.isCallExpression(node.parent)
      ) {
        use = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (!use) throw new Error('fixture identifier missing');
    expect(
      resolveLexicalBinding(file, use, use)?.initializer?.getText(file)
    ).toBe("'inner'");
  });

  it.each([
    [
      'for statement',
      "for (const target = '@/lib/supabase/service';;) { void import(target); break; }",
    ],
    [
      'case block',
      "switch (mode) { case 1: const target = '@/lib/supabase/service'; void import(target); break; }",
    ],
    [
      'module block',
      "namespace Scope { const target = '@/lib/supabase/service'; void import(target); }",
    ],
  ])('selects the shadowing declaration in a %s', (_name, innerSource) => {
    const { file, use } = importedTarget(
      `const target = './safe'; ${innerSource}`
    );

    expect(
      resolveLexicalBinding(file, use, use)?.initializer?.getText(file)
    ).toBe("'@/lib/supabase/service'");
  });
});
