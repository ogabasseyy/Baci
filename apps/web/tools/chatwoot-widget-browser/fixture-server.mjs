import { readFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { build } from 'vite';
import {
  fixtureDir,
  platformOrigin,
  storefrontHost,
  storefrontOrigin,
  storefrontPort,
  tokenA,
  tokenB,
} from './config.mjs';

export async function buildFixture({ certPath, keyPath, tempDir }) {
  process.env.CHATWOOT_FIXTURE_CERT = certPath;
  process.env.CHATWOOT_FIXTURE_KEY = keyPath;
  process.env.CHATWOOT_FIXTURE_PLATFORM_ORIGIN = platformOrigin;
  process.env.CHATWOOT_FIXTURE_STOREFRONT_PORT = String(storefrontPort);
  process.env.CHATWOOT_SYNTHETIC_TOKEN_A = tokenA;
  process.env.CHATWOOT_SYNTHETIC_TOKEN_B = tokenB;
  const siteDir = path.join(tempDir, 'site');
  await build({
    configFile: path.join(fixtureDir, 'vite.config.ts'),
    mode: 'production',
    build: { outDir: siteDir, emptyOutDir: true },
  });
  return siteDir;
}

export async function startFixtureServer({ certPath, keyPath, siteDir }) {
  const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
  ]);
  const fixtureCsp = [
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
  ].join('; ');
  const frontServer = https.createServer(
    { cert: await readFile(certPath), key: await readFile(keyPath) },
    async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', storefrontOrigin);
        const pathname = decodeURIComponent(url.pathname);
        let candidate = path.resolve(
          siteDir,
          pathname.replace(/^\/+/, '') || 'index.html'
        );
        let relative = path.relative(siteDir, candidate);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          response.writeHead(403).end();
          return;
        }
        let body;
        try {
          body = await readFile(candidate);
        } catch {
          if (pathname.startsWith('/assets/')) throw new Error('Asset missing');
          candidate = path.join(siteDir, 'index.html');
          relative = 'index.html';
          body = await readFile(candidate);
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': fixtureCsp,
          'Content-Type':
            contentTypes.get(path.extname(candidate)) ??
            'application/octet-stream',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    }
  );
  await new Promise((resolve, reject) => {
    frontServer.once('error', reject);
    frontServer.listen(storefrontPort, storefrontHost, resolve);
  });
  return frontServer;
}
