import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { resolveLexicalString } from './analytics-delivery-static-string';

function callArgument(source: string) {
  const file = ts.createSourceFile(
    'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
      call = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!call) throw new Error('fixture call missing');
  return { argument: call.arguments[0], call, file };
}

describe('resolveLexicalString', () => {
  it('uses the enclosing lexical binding instead of a later sibling binding', () => {
    const fixture = callArgument(
      "const key = 'outer'; { const key = 'inner'; use(key); } { const key = 'wrong'; }"
    );
    expect(
      resolveLexicalString(fixture.argument, fixture.file, fixture.call)
    ).toBe('inner');
  });

  it('resolves concatenated const strings', () => {
    const fixture = callArgument(
      "const prefix = 'event-'; const key = prefix + 'pipeline'; use(key);"
    );
    expect(
      resolveLexicalString(fixture.argument, fixture.file, fixture.call)
    ).toBe('event-pipeline');
  });

  it('rejects a self-referential immutable binding', () => {
    const fixture = callArgument('const key = key; use(key);');

    expect(
      resolveLexicalString(fixture.argument, fixture.file, fixture.call)
    ).toBeUndefined();
  });
});
