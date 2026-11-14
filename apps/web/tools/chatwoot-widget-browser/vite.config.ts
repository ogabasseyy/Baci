import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(fixtureDir, '../..');
const platformOrigin = process.env.CHATWOOT_FIXTURE_PLATFORM_ORIGIN;
const certPath = process.env.CHATWOOT_FIXTURE_CERT;
const keyPath = process.env.CHATWOOT_FIXTURE_KEY;
const resetDelayMs = Number(process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS ?? '0');

if (!platformOrigin || !certPath || !keyPath) {
  throw new Error('Missing local fixture origin or temporary TLS certificate');
}

export default defineConfig({
  root: fixtureDir,
  plugins: [react()],
  define: {
    __CHATWOOT_FIXTURE_PLATFORM_ORIGIN__: JSON.stringify(platformOrigin),
    __CHATWOOT_FIXTURE_TOKEN_A__: JSON.stringify(
      process.env.CHATWOOT_SYNTHETIC_TOKEN_A ?? ''
    ),
    __CHATWOOT_FIXTURE_TOKEN_B__: JSON.stringify(
      process.env.CHATWOOT_SYNTHETIC_TOKEN_B ?? ''
    ),
    __CHATWOOT_FIXTURE_RESET_DELAY_MS__: JSON.stringify(resetDelayMs),
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.join(webDir, 'src') },
      {
        find: 'next/navigation',
        replacement: path.join(fixtureDir, 'next-navigation.ts'),
      },
      {
        find: /^\.\/ogabassey\/components\/chat\/chatwoot-inline-cart-bridge$/,
        replacement: path.join(fixtureDir, 'ChatwootBridgeFixture.tsx'),
      },
      {
        find: /^\.\/reload-chatwoot-tenant-document$/,
        replacement: path.join(fixtureDir, 'reload-tenant-document.ts'),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '::1',
    port: Number(process.env.CHATWOOT_FIXTURE_STOREFRONT_PORT ?? 43128),
    strictPort: true,
    hmr: false,
    https: {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    },
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        `script-src 'self' 'unsafe-inline' ${platformOrigin}`,
        `style-src 'self' 'unsafe-inline' ${platformOrigin}`,
        `img-src 'self' data: blob: ${platformOrigin}`,
        `font-src 'self' data: ${platformOrigin}`,
        `connect-src 'self' ${platformOrigin} ${platformOrigin.replace(/^https:/, 'wss:')}`,
        `frame-src 'self' ${platformOrigin}`,
      ].join('; '),
    },
  },
});
