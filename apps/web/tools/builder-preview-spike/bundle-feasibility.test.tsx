// @vitest-environment node

import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { blockTypes, catalog, home, merchant } from './fixtures';

describe('Task 0 portable six-block renderer acceptance', () => {
  it('bundles the actual shared renderer without editor/Next/Supabase or stubs', async () => {
    expect(new Set(home.content.map((block) => block.type))).toEqual(
      new Set(blockTypes)
    );
    const result = await build({
      entryPoints: ['tools/builder-preview-spike/widget-entry.tsx'],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'BaciPreview',
      write: false,
      metafile: true,
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'reject-nonportable-preview-dependencies',
          setup(builder) {
            builder.onResolve(
              { filter: /^(next(?:\/|$)|@puckeditor\/|@supabase\/)/ },
              (args) => ({
                errors: [
                  { text: `Nonportable preview dependency: ${args.path}` },
                ],
              })
            );
            builder.onLoad({ filter: /components\/builder\// }, () => ({
              errors: [{ text: 'Preview imports editor code' }],
            }));
          },
        },
      ],
    });
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    expect(inputs.some((path) => path.endsWith('/portable-home.tsx'))).toBe(
      true
    );
    expect(
      inputs.some((path) => /next\/|builder\/config|supabase/.test(path))
    ).toBe(false);
    const snapshotJson = JSON.stringify({
      config: home,
      merchant,
      catalog,
    }).replace(/</g, '\\u003c');
    const bootstrap = `BaciPreview.mountPortablePreview(document.getElementById('root'),${snapshotJson});`;
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script>${result.outputFiles[0].text}${bootstrap}</script></body></html>`;
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(gzipSync(html).byteLength).toBeLessThanOrEqual(1024 * 1024);
    await writeFile('/tmp/baci-builder-preview.html', html);
    await writeFile(
      '/tmp/baci-builder-preview-bundle.json',
      JSON.stringify(
        {
          rawHtmlBytes: Buffer.byteLength(html),
          gzipHtmlBytes: gzipSync(html).byteLength,
          inputs,
        },
        null,
        2
      )
    );
    console.info(
      JSON.stringify({
        rawHtmlBytes: Buffer.byteLength(html),
        gzipHtmlBytes: gzipSync(html).byteLength,
        inputs: inputs.length,
      })
    );
  });
});
