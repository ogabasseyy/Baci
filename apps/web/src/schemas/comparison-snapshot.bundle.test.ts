// @vitest-environment node

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('keeps storage validation below 50KB of minified browser JavaScript', async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('./comparison-snapshot.ts', import.meta.url)),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  expect(result.outputFiles[0].contents.byteLength).toBeLessThan(50_000);
});
