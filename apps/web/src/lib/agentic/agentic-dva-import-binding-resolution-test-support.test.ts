import ts from '@typescript/typescript6';
import { describe, expect, it, vi } from 'vitest';
import { resolveImportedBinding } from './agentic-dva-import-binding-resolution-test-support';

describe('resolveImportedBinding', () => {
  it('resolves an aliased named import used by a local export', () => {
    const resolveModule = vi.fn(() => 'apps/web/src/lib/paystack.ts');
    const ast = ts.createSourceFile(
      'barrel.ts',
      "import { generatePaymentAccount as localCreate } from './paystack';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const result = resolveImportedBinding({
      ast,
      localName: 'localCreate',
      resolveModule,
    });

    expect(result).toEqual({
      exportName: 'generatePaymentAccount',
      modulePath: 'apps/web/src/lib/paystack.ts',
    });
    expect(resolveModule).toHaveBeenCalledWith('./paystack');
  });

  it('returns null for namespace imports and missing local bindings', () => {
    const missingBindingAst = ts.createSourceFile(
      'barrel.ts',
      "import { generatePaymentAccount } from './paystack';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(
      resolveImportedBinding({
        ast: missingBindingAst,
        localName: 'localCreate',
        resolveModule: vi.fn(),
      })
    ).toBeNull();

    const namespaceAst = ts.createSourceFile(
      'barrel.ts',
      "import * as paystack from './paystack';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(
      resolveImportedBinding({
        ast: namespaceAst,
        localName: 'localCreate',
        resolveModule: vi.fn(),
      })
    ).toBeNull();
  });

  it('returns null when a named import module cannot be resolved', () => {
    const ast = ts.createSourceFile(
      'barrel.ts',
      "import { generatePaymentAccount as localCreate } from './missing';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(
      resolveImportedBinding({
        ast,
        localName: 'localCreate',
        resolveModule: () => null,
      })
    ).toBeNull();
  });
});
