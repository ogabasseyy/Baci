import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { createSdkOpenReceiverChecker } from './sdk-binding-resolver';

function parseVirtualFiles(
  entries: Record<string, string>
): Map<string, ts.SourceFile> {
  const map = new Map<string, ts.SourceFile>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(
      filePath,
      ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
    );
  }
  return map;
}

function checkFirstOpenCallAllowed(entries: Record<string, string>): boolean {
  const files = parseVirtualFiles(entries);
  const entryPath = 'src/App.tsx';
  const sf = files.get(entryPath);
  if (!sf) throw new Error('Missing src/App.tsx');
  const isAllowed = createSdkOpenReceiverChecker(files)(entryPath, sf);
  let result: boolean | null = null;
  const walk = (node: ts.Node): void => {
    if (result !== null) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'open'
    ) {
      result = isAllowed(node.expression.expression);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  if (result === null) throw new Error('Expected .open() call in src/App.tsx');
  return result;
}

describe('createSdkOpenReceiverChecker & lexical-const-lookup', () => {
  it('accepts direct factory calls, namespace imports, relative re-exports, and destructured navigation/checkout', () => {
    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { useCommerce().navigation.open('/cart'); return null; }`,
      })
    ).toBe(true);

    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import * as sdk from '@baci/experience-sdk';\nexport default function App() { const { navigation } = sdk.useCommerce(); navigation.open('/cart'); return null; }`,
      })
    ).toBe(true);

    expect(
      checkFirstOpenCallAllowed({
        'src/sdk.ts': `export { useCommerce as useStoreSdk } from '@baci/experience-sdk';`,
        'src/App.tsx': `import { useStoreSdk } from './sdk';\nexport default function App() { const c = useStoreSdk(); c.checkout.open(); return null; }`,
      })
    ).toBe(true);

    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { connectExperience } from '@baci/experience-sdk';\nexport default function App() { const { commerce } = connectExperience('https://usebaci.com'); const nav = commerce.navigation; nav.open('/cart'); return null; }`,
      })
    ).toBe(true);
  });

  it('rejects parameter shadowing, nested hoisted var shadowing, and loop initializer shadowing', () => {
    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App(useCommerce: any) { useCommerce().navigation.open('https://evil.example'); return null; }`,
      })
    ).toBe(false);

    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { useCommerce().navigation.open('https://evil.example'); if (false) { var useCommerce: any = null; } return null; }`,
      })
    ).toBe(false);

    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { for (const useCommerce of [(() => ({ navigation: window })) as any]) { useCommerce().navigation.open('https://evil.example'); } return null; }`,
      })
    ).toBe(false);
  });

  it('rejects direct property mutation, alias property mutation, and cyclic re-exports without hanging', () => {
    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { const c: any = useCommerce(); c.navigation = {}; c.navigation.open('https://evil.example'); return null; }`,
      })
    ).toBe(false);

    expect(
      checkFirstOpenCallAllowed({
        'src/App.tsx': `import { useCommerce } from '@baci/experience-sdk';\nexport default function App() { const c: any = useCommerce(); const alias = c; alias.navigation = {}; c.navigation.open('https://evil.example'); return null; }`,
      })
    ).toBe(false);

    expect(
      checkFirstOpenCallAllowed({
        'src/a.ts': `export { useCommerce } from './b';`,
        'src/b.ts': `export { useCommerce } from './a';`,
        'src/App.tsx': `import { useCommerce } from './a';\nexport default function App() { useCommerce().navigation.open('/cart'); return null; }`,
      })
    ).toBe(false);
  });
});
