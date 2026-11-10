import { createServer, request } from 'node:https';
import { expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { createPreviewVault } from '../../src/lib/experience/preview-service';
import { createPerformanceTls } from './performance-tls';
import { createProductionPreviewDelivery } from './preview-delivery';

it('serves immutable output over verified local TLS and denies it after revocation, expiry and rollback', async () => {
  const executionOrigin = 'https://output.synthetic-execution.test';
  const hostOrigin = 'https://builder.synthetic-merchant.test';
  const tls = createPerformanceTls([executionOrigin, hostOrigin]);
  let active = true;
  let installed = true;
  let now = Date.now();
  const vault = createPreviewVault({
    origin: executionOrigin,
    now: () => now,
    isActive: async () => active,
  });
  const bytes = Buffer.from('export const synthetic=true;');
  const resource = () =>
    vault.consume(
      'owner',
      vault.create({
        ownerId: 'owner',
        bindingId: 'synthetic',
        buildDigest: 'a'.repeat(64),
        files: [
          {
            path: 'app.js',
            mime: 'text/javascript',
            bytes,
            digest: digestBytes(bytes),
          },
        ],
      })
    ).resources[0];
  const serve = createProductionPreviewDelivery({
    vault,
    executionOrigin,
    hostOrigins: [hostOrigin],
  });
  const server = createServer(tls.options, (req, res) => {
    void (async () => {
      const response = installed
        ? await serve(
            new Request(`${executionOrigin}${req.url}`, { method: req.method })
          )
        : new Response(null, {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const get = (url: string, method = 'GET') =>
      new Promise<{
        status: number | undefined;
        headers: import('node:http').IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: new URL(url).pathname,
            servername: new URL(executionOrigin).hostname,
            ca: tls.options.cert,
            method,
            agent: false,
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk.toString();
            });
            res.on('end', () =>
              resolve({ status: res.statusCode, headers: res.headers, body })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });
    const file = resource();
    const response = await get(file.url);
    expect(response.status).toBe(200);
    expect(response.body).toBe(bytes.toString());
    expect(response.headers['content-security-policy']).toContain(
      "connect-src 'none'"
    );
    expect(response.headers['content-security-policy']).toContain(
      `frame-ancestors ${hostOrigin}`
    );
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(
      response.headers['access-control-allow-credentials']
    ).toBeUndefined();
    expect((await get(file.url, 'POST')).status).toBe(404);
    active = false;
    expect((await get(file.url)).status).toBe(404);
    active = true;
    const expiring = resource();
    now += 600001;
    expect((await get(expiring.url)).status).toBe(404);
    const rollback = resource();
    installed = false;
    expect((await get(rollback.url)).status).toBe(503);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    tls.close();
  }
});
