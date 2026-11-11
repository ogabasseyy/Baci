import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('traces all Chromium archives in a real Turbopack build only where used', () => {
  const root = resolve(__dirname, '../../../..');
  const fixture = mkdtempSync(join(root, 'apps/.receipt-trace-'));
  try {
    copyFileSync(
      join(__dirname, 'receipt-chromium-directory.ts'),
      join(fixture, 'receipt-chromium-directory.ts')
    );
    writeFileSync(
      join(fixture, 'next.config.mjs'),
      `export default {
        outputFileTracingRoot: ${JSON.stringify(root)},
        experimental: { cpus: 1 },
      };`
    );
    const orders = join(fixture, 'app/api/orders');
    const unrelated = join(orders, '[id]');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(
      join(orders, 'route.js'),
      `import { resolvePackagedChromiumDirectory } from '../../../receipt-chromium-directory';
       export function GET() { return Response.json(!!resolvePackagedChromiumDirectory()); }`
    );
    writeFileSync(
      join(unrelated, 'route.js'),
      'export function GET() { return Response.json(true); }'
    );
    const nextBin = createRequire(import.meta.url).resolve(
      'next/dist/bin/next'
    );
    execFileSync(
      process.execPath,
      [nextBin, 'build', '--experimental-build-mode=compile'],
      {
        cwd: fixture,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: '1',
          NODE_ENV: 'production',
        },
        timeout: 60_000,
      }
    );
    const trace = (route: string) => {
      const { files }: { files: string[] } = JSON.parse(
        readFileSync(
          join(fixture, '.next/server/app/api', route, 'route.js.nft.json'),
          'utf8'
        )
      );
      return files
        .filter((file) => file.includes('/@sparticuz/chromium/bin/'))
        .map((file) => file.split('/').at(-1))
        .sort();
    };
    expect(trace('orders')).toEqual([
      'al2023.tar.br',
      'chromium.br',
      'fonts.tar.br',
      'swiftshader.tar.br',
    ]);
    expect(trace('orders/[id]')).toEqual([]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 65_000);
