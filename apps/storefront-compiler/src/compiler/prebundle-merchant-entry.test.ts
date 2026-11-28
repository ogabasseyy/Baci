import { describe, expect, it } from 'vitest';
import { StorefrontCompilerError } from './closed-graph-plugin';
import { prebundleMerchantEntrySource } from './prebundle-merchant-entry';

describe('prebundle-merchant-entry', () => {
  it('prebundles client and worker entries with external singletons and rejects graph escapes', async () => {
    const files = new Map([
      [
        'src/App.tsx',
        `import { useCommerce } from '@baci/experience-sdk'; export default function App() { const c = useCommerce(); return <main>{typeof c}</main>; }`,
      ],
    ]);
    const workerOut = await prebundleMerchantEntrySource({
      entry: 'src/App.tsx',
      virtualFiles: files,
      declaredPackages: new Set(['react', '@baci/experience-sdk']),
      declaredAssetIds: new Set(),
      targetRuntime: 'worker',
    });
    expect(workerOut).toContain('@baci/experience-sdk');

    await expect(
      prebundleMerchantEntrySource({
        entry: 'src/App.tsx',
        virtualFiles: new Map([
          ['src/App.tsx', `import fs from 'node:fs'; export default () => fs;`],
        ]),
        declaredPackages: new Set(['react']),
        declaredAssetIds: new Set(),
        targetRuntime: 'client',
      })
    ).rejects.toBeInstanceOf(StorefrontCompilerError);
  });
});
