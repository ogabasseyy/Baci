import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Count the files as deployed, including the stored .br archives.
// This package budget does not measure runtime extraction disk or browser memory.
const MAX_FUNCTION_BYTES = 250 * 1024 * 1024;
const CHROMIUM_FILES = [
  'chromium.br',
  'al2023.tar.br',
  'fonts.tar.br',
  'swiftshader.tar.br',
];

async function readTracedFile(routeFile, file) {
  try {
    return (await stat(resolve(dirname(routeFile), file))).size;
  } catch (error) {
    throw new Error(`${routeFile} cannot read traced file ${file}`, { cause: error });
  }
}

export async function verifyInvoicePdfBuildTrace(routeFile) {
  const trace = JSON.parse(await readFile(`${routeFile}.nft.json`, 'utf8'));
  const missing = CHROMIUM_FILES.filter(
    (asset) => !trace.files.some((file) =>
      file.endsWith(`/@sparticuz/chromium/bin/${asset}`)
    )
  );
  if (missing.length) {
    throw new Error(`${routeFile} is missing Chromium assets: ${missing.join(', ')}`);
  }

  // Each path appears once in the deployment; distinct paths count separately.
  const files = new Map(
    [resolve(routeFile), ...trace.files].map((file) => [
      resolve(dirname(routeFile), file),
      file,
    ])
  );
  const sizes = await Promise.all(
    [...files.values()].map((file) => readTracedFile(routeFile, file))
  );
  const bytes = sizes.reduce((total, size) => total + size, 0);
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
