import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { expect, it } from 'vitest';
import { INVOICE_PDF_FILE_TRACING_INCLUDES } from './invoice-pdf-file-tracing';

it('loads the real Next configuration and traces only the PDF routes', () => {
  const webRoot = resolve(__dirname, '../..');
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `const { PHASE_PRODUCTION_BUILD } = require('next/constants');
       require('next/dist/server/config').default(PHASE_PRODUCTION_BUILD, process.cwd())
         .then(({ outputFileTracingRoot, outputFileTracingIncludes, serverExternalPackages }) => {
           process.stdout.write('INVOICE_TRACE=' + JSON.stringify({
             outputFileTracingRoot, outputFileTracingIncludes, serverExternalPackages,
           }));
         }).catch((error) => { console.error(error); process.exitCode = 1; });`,
    ],
    {
      cwd: webRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    }
  );
  const [, config] = stdout.split('INVOICE_TRACE=');
  expect(config).toBeDefined();
  const nextConfig: NextConfig = JSON.parse(config ?? '{}');

  expect(nextConfig.serverExternalPackages).toEqual(
    expect.arrayContaining(['@sparticuz/chromium', 'puppeteer-core'])
  );
  expect(nextConfig.outputFileTracingRoot).toBe(resolve(webRoot, '../..'));
  expect(nextConfig.outputFileTracingIncludes).toMatchObject(
    INVOICE_PDF_FILE_TRACING_INCLUDES
  );
  const picomatch: (
    pattern: string,
    options: { contains: boolean; dot: boolean }
  ) => (route: string) => boolean = createRequire(import.meta.url)(
    'next/dist/compiled/picomatch'
  );
  const includesChromium = (route: string) =>
    Object.entries(nextConfig.outputFileTracingIncludes ?? {}).some(
      ([scope, files]) =>
        files.includes('../../node_modules/@sparticuz/chromium/bin/**/*') &&
        picomatch(scope, { contains: true, dot: true })(route)
    );
  for (const route of [
    '/api/orders',
    '/api/orders/[id]/invoice',
    '/api/storefront/account/orders/[id]/invoice',
    '/api/storefront/account/orders/[id]/receipt',
    '/api/cron/order-notifications',
  ]) {
    expect(includesChromium(route)).toBe(true);
  }
  for (const route of [
    '/api/orders/[id]',
    '/api/orders/[id]/generate-dva',
    '/api/storefront/account/orders/[id]',
  ]) {
    expect(includesChromium(route)).toBe(false);
  }
  expect(
    existsSync(
      resolve(webRoot, '../../node_modules/@sparticuz/chromium/bin/chromium.br')
    )
  ).toBe(true);
});
