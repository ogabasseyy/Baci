import './test-env.test-setup.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storefrontHost, storefrontPort } from './config.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { createTlsCertificate } from './tls.mjs';

let dir;
let server;

function get(pathname) {
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          host: storefrontHost,
          port: storefrontPort,
          path: pathname,
          rejectUnauthorized: false,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body })
          );
        }
      )
      .on('error', reject);
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chatwoot-fixture-test-'));
  const siteDir = join(dir, 'site');
  await mkdir(join(siteDir, 'assets'), { recursive: true });
  await writeFile(join(siteDir, 'index.html'), '<p>index</p>');
  await writeFile(join(siteDir, 'assets', 'a.js'), 'x');
  const certPath = join(dir, 'c.pem');
  const keyPath = join(dir, 'k.pem');
  await createTlsCertificate({ certPath, keyPath });
  server = await startFixtureServer({ certPath, keyPath, siteDir });
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await rm(dir, { recursive: true });
});

describe('fixture server', () => {
  it('serves assets with a content type and a restrictive CSP', async () => {
    const res = await get('/assets/a.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'"
    );
  });

  it('falls back to index.html for unknown routes but 404s missing assets', async () => {
    expect((await get('/shop/checkout')).body).toBe('<p>index</p>');
    expect((await get('/assets/missing.js')).status).toBe(404);
  });

  it('rejects path traversal outside the site directory', async () => {
    const res = await get('/..%2f..%2fetc/passwd');
    expect(res.status).toBe(403);
  });
});
