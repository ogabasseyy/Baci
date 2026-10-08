import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { startLocalSavingsBrowserGateway } from './local-savings-browser-gateway.mjs';

test('preserves genuine local auth/CSRF while blocking financial writes and remote origins', async () => {
  const upstream = createServer((request, response) => {
    response.setHeader(
      'set-cookie',
      'synthetic-session=value; HttpOnly; SameSite=Lax'
    );
    response.end(
      JSON.stringify({
        cookie: request.headers.cookie,
        csrf: request.headers['x-csrf-token'],
      })
    );
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = await startLocalSavingsBrowserGateway({
    port: 4196,
    upstreamPort: upstream.address().port,
  });
  try {
    assert.equal((await fetch(`${gateway.origin}/api/csrf`)).status, 200);
    assert.equal((await fetch(`${gateway.origin}/api/csrf-token`)).status, 403);
    const response = await fetch(
      `${gateway.origin}/api/storefront/customer/savings/drafts`,
      {
        method: 'POST',
        headers: {
          origin: gateway.origin,
          cookie: 'synthetic-cookie',
          'x-csrf-token': 'synthetic-csrf',
        },
        body: '{}',
      }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cookie: 'synthetic-cookie',
      csrf: 'synthetic-csrf',
    });
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(
      response.headers.get('content-security-policy'),
      /frame-src 'none'/
    );
    assert.equal(
      (
        await fetch(
          `${gateway.origin}/_next/static/chunks/node_modules_%40swc_helpers.js`
        )
      ).status,
      200
    );
    assert.equal(
      (await fetch(`${gateway.origin}/api/storefront/auth/%73ession`)).status,
      404
    );
    for (const [path, options] of [
      ['/api/payments/initialize', { method: 'POST' }],
      [
        '/api/storefront/auth/send-code',
        { method: 'POST', headers: { origin: 'https://example.com' } },
      ],
      [
        '/api/storefront/auth/session',
        { headers: { 'x-forwarded-host': 'example.com' } },
      ],
      ['/api/cron/drain', {}],
    ])
      assert.equal((await fetch(gateway.origin + path, options)).status, 403);
    assert.equal(
      (
        await fetch(`${gateway.origin}/api/storefront/auth/send-code`, {
          method: 'POST',
          body: 'x'.repeat(32769),
        })
      ).status,
      413
    );
  } finally {
    await gateway.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('requires explicit distinct local ports', async () => {
  await assert.rejects(
    startLocalSavingsBrowserGateway({ port: 80, upstreamPort: 3018 })
  );
  await assert.rejects(
    startLocalSavingsBrowserGateway({ port: 3018, upstreamPort: 3018 })
  );
});

test('forwards only same-origin Next HMR upgrades needed for development hydration', async () => {
  const upstream = createServer();
  upstream.on('upgrade', (_request, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
    );
    socket.on('data', () => socket.end('synthetic-hmr'));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = await startLocalSavingsBrowserGateway({
    port: 4197,
    upstreamPort: upstream.address().port,
  });
  const probe = (path, origin) =>
    new Promise((resolve, reject) => {
      const connection = request(`${gateway.origin}${path}`, {
        headers: { origin, connection: 'Upgrade', upgrade: 'websocket' },
      });
      connection.setTimeout(2000, () =>
        connection.destroy(new Error('Upgrade timeout'))
      );
      connection.on('upgrade', (_response, socket, head) => {
        if (head.length) resolve(head.toString());
        socket.once('data', (data) => {
          resolve(data.toString());
          socket.destroy();
        });
        socket.on('error', reject);
        socket.write('probe');
      });
      connection.on('error', reject);
      connection.end();
    });
  try {
    assert.equal(
      await probe('/_next/hmr?id=synthetic', gateway.origin),
      'synthetic-hmr'
    );
    await assert.rejects(probe('/api/payments', gateway.origin));
    await assert.rejects(probe('/_next/hmr', 'https://example.com'));
  } finally {
    await gateway.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
