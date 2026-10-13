import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { collectPrivilegedAliases } from './agentic-dva-privileged-alias-test-support';

function collect(source: string) {
  const bindings = new Set<string>();
  collectPrivilegedAliases({
    ast: ts.createSourceFile(
      'example.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    ),
    bindings,
    namespaces: new Map([['paystack', 'paystack-module']]),
    resolvesTarget: (namespace, exportName) =>
      namespace === 'paystack-module' &&
      exportName === 'generatePaymentAccount',
  });
  return bindings;
}

describe('collectPrivilegedAliases', () => {
  it('tracks property, destructured, and chained aliases', () => {
    const bindings = collect(`
      const propertyAlias = paystack.generatePaymentAccount;
      const { generatePaymentAccount: destructuredAlias } = paystack;
      const chainedAlias = propertyAlias;
    `);

    expect(bindings).toEqual(
      new Set(['propertyAlias', 'destructuredAlias', 'chainedAlias'])
    );
  });

  it('ignores aliases of unrelated namespace exports', () => {
    const bindings = collect(
      'const create = paystack.verifyTransaction; const alias = create;'
    );

    expect(bindings).toEqual(new Set());
  });
});
