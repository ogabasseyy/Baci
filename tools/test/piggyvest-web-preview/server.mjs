import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createPreviewConfig } from './config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(root, '../../..');
const appRequire = createRequire(resolve(workspace, 'apps/web/package.json'));
const { createServer } = await import(
  pathToFileURL(appRequire.resolve('vite')).href
);
const { default: tailwind } = await import(
  pathToFileURL(appRequire.resolve('@tailwindcss/postcss')).href
);
export async function startPreview() {
  const server = await createServer(
    createPreviewConfig(tailwind({ base: root }))
  );
  await server.listen();
  server.printUrls();
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await startPreview();
}
