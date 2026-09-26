import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, 'src');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

export async function createWidgetHtml() {
  const entryPoint = path.join(SRC_DIR, 'index.tsx');
  const cssPath = path.join(SRC_DIR, 'styles.css');

  // Bundle JS/TSX
  const jsResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    jsx: 'automatic',
    jsxImportSource: 'react',
    target: ['es2020'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    external: [], // Bundle everything
  });

  const jsCode = jsResult.outputFiles[0].text;

  // Read CSS
  const cssCode = fs.readFileSync(cssPath, 'utf8').replace(
    /\/\* @include:(styles-(?:header|single-card|responsive)\.css) \*\//g,
    (_, file) => fs.readFileSync(path.join(SRC_DIR, file), 'utf8')
  );

  // Create HTML bundle with skybridge compatibility
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="color-scheme" content="dark light">
  <style>${cssCode}</style>
</head>
<body>
  <div id="ogabassey-root"></div>
  <script type="module">${jsCode}</script>
</body>
</html>`;

  return htmlContent;
}

async function main() {
  const outPath = path.join(ASSETS_DIR, 'ogabassey-store.html');
  const htmlContent = await createWidgetHtml();
  if (process.argv.includes('--check')) {
    const committed = fs.readFileSync(outPath, 'utf8');
    if (committed !== htmlContent) throw new Error('Committed widget bundle is stale. Run pnpm --filter ogabassey-widgets build.');
    console.log('Committed widget bundle matches source.');
    return;
  }
  console.log('Building Ogabassey Premium Widget...');
  fs.writeFileSync(outPath, htmlContent);
  console.log(
    `✓ Built ${outPath} (${(htmlContent.length / 1024).toFixed(1)}KB)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
    console.log('\n✅ Widget build complete!');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}
