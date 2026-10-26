import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
export async function createPreviewHtml() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./src/index.tsx', import.meta.url))],
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'portable-only',
        setup(b) {
          b.onResolve(
            { filter: /^(next(?:\/|$)|@puckeditor\/|@supabase\/)/ },
            (args) => ({
              errors: [{ text: `Forbidden widget dependency: ${args.path}` }],
            })
          );
          b.onLoad({ filter: /components\/builder\// }, () => ({
            errors: [{ text: 'Editor dependency in preview' }],
          }));
        },
      },
    ],
  });
  const script = result.outputFiles[0].text.replace(
    /<\/script/gi,
    '<\\/script'
  );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>body{margin:0;font:14px system-ui}.builder-preview{background:var(--color-background-primary,Canvas);color:var(--color-text-primary,CanvasText)}.preview-toolbar,section[aria-label],.preview-revision,[role=alert],[role=status]{padding:12px}.preview-toolbar{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center}h1{font-size:18px}h2{font-size:16px}button{font:inherit;padding:8px 12px;margin:4px;border-radius:8px;border:1px solid GrayText;background:transparent;color:inherit}button:focus-visible{outline:3px solid Highlight;outline-offset:2px}[role=alert]{border:2px solid currentColor;overflow-wrap:anywhere}.preview-revision{overflow-wrap:anywhere}</style></head><body><div id="root"></div><script type="module">${script}</script></body></html>`;
  const raw = Buffer.byteLength(html);
  const gzip = gzipSync(html).byteLength;
  if (raw > 3 * 1024 * 1024 || gzip > 1024 * 1024)
    throw Error('Preview exceeds size ceiling');
  return { html, raw, gzip, inputs: Object.keys(result.metafile.inputs) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await createPreviewHtml();
  await writeFile(new URL('../preview.html', import.meta.url), result.html);
  console.log(
    JSON.stringify({
      raw: result.raw,
      gzip: result.gzip,
      modules: result.inputs.length,
    })
  );
}
