import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  COMPILER_ROOT,
  createClosedStorefrontGraphPlugin,
} from './closed-graph-plugin';

async function bundleVirtual(
  virtualFiles: Map<string, string>,
  declaredPackages = new Set(['react']),
  declaredAssetIds = new Set(['hero-banner'])
) {
  return build({
    entryPoints: ['src/App.tsx'],
    absWorkingDir: COMPILER_ROOT,
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    plugins: [
      createClosedStorefrontGraphPlugin({
        virtualFiles,
        declaredPackages,
        declaredAssetIds,
        externalSingletons: new Set(['react']),
      }),
    ],
  });
}

describe('closed-graph-plugin', () => {
  it('resolves virtual relative modules and declared packages while blocking escapes and undeclared imports', async () => {
    const ok = await bundleVirtual(
      new Map([
        [
          'src/App.tsx',
          `import { Label } from './Label'; export default function App() { return <Label />; }`,
        ],
        [
          'src/Label.tsx',
          `export function Label() { return <span>ok</span>; }`,
        ],
      ])
    );
    expect(ok.outputFiles?.[0]?.text).toContain('ok');

    await expect(
      bundleVirtual(
        new Map([
          [
            'src/App.tsx',
            `import x from '../../package.json'; export default () => String(x);`,
          ],
        ])
      )
    ).rejects.toThrow(/escapes virtual source root/);

    await expect(
      bundleVirtual(
        new Map([
          [
            'src/App.tsx',
            `import { z } from 'zod'; export default () => String(z);`,
          ],
        ])
      )
    ).rejects.toThrow(/Undeclared package "zod"/);

    await expect(
      bundleVirtual(
        new Map([
          [
            'src/App.tsx',
            `import { hydrateRoot } from 'react-dom/client'; export default () => String(hydrateRoot);`,
          ],
        ]),
        new Set(['react', 'react-dom'])
      )
    ).rejects.toThrow(/Prohibited merchant subpath specifier/);
  });
});
