import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { resolveLexicalModuleSpecifier } from './analytics-delivery-module-specifier';

function importCall(source: string) {
  const file = ts.createSourceFile(
    'fixture.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const call = file.statements
    .flatMap((statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression)
        ? [statement.expression]
        : []
    )
    .at(0);
  return { call, file };
}

describe('resolveLexicalModuleSpecifier', () => {
  it('resolves a const-bound template expression recursively', () => {
    const { call, file } = importCall(
      [
        "const directory = '../supabase';",
        "const name = 'service';",
        `const target = \`\${directory}/\${name}\`;`,
        'import(target);',
      ].join(' ')
    );
    expect(
      resolveLexicalModuleSpecifier(call?.arguments[0], file, call ?? file)
    ).toBe('../supabase/service');
  });

  it('fails closed for a mutable template substitution', () => {
    const { call, file } = importCall(
      `let name = 'service'; import(\`../supabase/\${name}\`);`
    );
    expect(
      resolveLexicalModuleSpecifier(call?.arguments[0], file, call ?? file)
    ).toBeUndefined();
  });

  it('resolves one immutable template part reused across sibling spans', () => {
    const { call, file } = importCall(
      [
        "const slash = '/';",
        `const part = \`\${slash}\`;`,
        `const target = \`@\${part}lib\${part}supabase\${part}service\`;`,
        'import(target);',
      ].join(' ')
    );

    expect(
      resolveLexicalModuleSpecifier(call?.arguments[0], file, call ?? file)
    ).toBe('@/lib/supabase/service');
  });

  it('unwraps a template expression constrained with satisfies', () => {
    const { call, file } = importCall(
      `const name = 'supabase/service'; import((\`@/lib/\${name}\` satisfies string));`
    );

    expect(
      resolveLexicalModuleSpecifier(call?.arguments[0], file, call ?? file)
    ).toBe('@/lib/supabase/service');
  });

  it('fails closed for a cyclic const-bound template', () => {
    const { call, file } = importCall(
      `const target = \`\${target}\`; import(target);`
    );

    expect(
      resolveLexicalModuleSpecifier(call?.arguments[0], file, call ?? file)
    ).toBeUndefined();
  });
});
