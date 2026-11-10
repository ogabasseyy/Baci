import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FUNCTION_BYTES = 250 * 1024 * 1024;
const CHROMIUM_BIN = /(?:^|\/)@sparticuz\/chromium\/bin\//;
const CHROMIUM_FILES = [
  'chromium.br',
  'al2023.tar.br',
  'fonts.tar.br',
  'swiftshader.tar.br',
];

async function readTracedFile(routeFile, file) {
  try {
    const path = await realpath(resolve(dirname(routeFile), file));
    return [path, (await stat(path)).size];
  } catch (error) {
    throw new Error(`${routeFile} cannot read traced file ${file}`, { cause: error });
  }
}

export async function verifyInvoicePdfBuildTrace(routeFile) {
  const trace = JSON.parse(await readFile(`${routeFile}.nft.json`, 'utf8'));
  const browserFiles = new Set(
    trace.files
      .filter((file) => CHROMIUM_BIN.test(file))
      .map((file) => file.split('/').at(-1))
  );
  const missing = CHROMIUM_FILES.filter((file) => !browserFiles.has(file));
  if (missing.length) {
    throw new Error(`${routeFile} is missing Chromium assets: ${missing.join(', ')}`);
  }

  const files = new Map(await Promise.all(
    [resolve(routeFile), ...trace.files].map((file) => readTracedFile(routeFile, file))
  ));
  const bytes = [...files.values()].reduce((total, size) => total + size, 0);
  if (bytes > MAX_FUNCTION_BYTES) {
    throw new Error(`${routeFile} traces ${bytes} bytes, above the 250 MiB function budget`);
  }
  return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? 'apps/web/.next/server/app/api');
  for (const route of [
    'orders',
    'orders/[id]/invoice',
    'storefront/account/orders/[id]/invoice',
    'storefront/account/orders/[id]/receipt',
    'cron/order-notifications',
  ]) {
    const bytes = await verifyInvoicePdfBuildTrace(join(root, route, 'route.js'));
    process.stdout.write(`Invoice PDF trace for ${route}: ${bytes} bytes\n`);
  }
}
