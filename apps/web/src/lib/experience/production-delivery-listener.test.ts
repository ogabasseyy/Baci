// @vitest-environment node
import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createProductionPreviewDelivery } from '../../../tools/experience-runner/preview-delivery';
import { digestBytes } from './manifest-digest';
import { createPreviewVault } from './preview-service';

vi.mock('server-only', () => ({}));

import { createProductionDeliveryListener } from './production-delivery-listener';

it('serves a real private vault resource and denies it when its binding is revoked', async () => {
  let active = true;
  const executionOrigin = 'https://output.runtime.test';
  const hostOrigin = 'https://builder.baci.test';
  const vault = createPreviewVault({
    origin: executionOrigin,
    now: Date.now,
    isActive: async () => active,
  });
  const bytes = Buffer.from('export const synthetic=true;');
  const ref = vault.create({
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
  });
  const resource = vault.consume('owner', ref).resources[0];
  const deliver = createProductionPreviewDelivery({
    vault,
    executionOrigin,
    hostOrigins: [hostOrigin],
  });
  const listener = createProductionDeliveryListener({
    executionOrigin,
    deliver,
  });
  listener.server.listen(0, '127.0.0.1');
  await once(listener.server, 'listening');
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const path = new URL(resource.url).pathname;
    const response = await send(address.port, path, { origin: 'null' });
    expect(response.status).toBe(200);
    expect(response.body).toBe(bytes.toString());
    expect(response.headers['content-security-policy']).toContain(
      "connect-src 'none'"
    );
    expect(response.headers['access-control-allow-origin']).toBe('null');
    const foreign = await send(address.port, path, {
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(404);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    active = false;
    expect((await send(address.port, path, { origin: 'null' })).status).toBe(
      404
    );
  } finally {
    await listener.close();
  }
});

async function send(
  port: number,
  path: string,
  options: {
    method?: string;
    host?: string;
    origin?: string;
    cookie?: string;
  } = {}
) {
  return await new Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          host: options.host ?? 'output.runtime.test',
          ...(options.origin ? { origin: options.origin } : {}),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

it('serves output on loopback with a fixed execution origin and forwards only the origin header', async () => {
  const deliver = vi.fn(async (incoming: Request) => {
    expect(incoming.url).toBe(
      'https://output.runtime.test/resource/fixture/app.js'
    );
    expect(incoming.headers.get('origin')).toBe('null');
    expect(incoming.headers.get('cookie')).toBeNull();
    return new Response('fixture', {
      headers: {
        'content-type': 'text/javascript',
        'cache-control': 'private, no-store',
        'content-security-policy': "default-src 'none'",
      },
    });
  });
  const listener = createProductionDeliveryListener({
    executionOrigin: 'https://output.runtime.test',
    deliver,
  });
  listener.server.listen(0, '127.0.0.1');
  await once(listener.server, 'listening');
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const response = await send(address.port, '/resource/fixture/app.js', {
      origin: 'null',
      cookie: 'private=1',
    });
    expect(response).toMatchObject({
      status: 200,
      body: 'fixture',
      headers: {
        'cache-control': 'private, no-store',
        'content-security-policy': "default-src 'none'",
      },
    });
    expect(deliver).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
  }
});

it('rejects foreign hosts, unsafe request targets, unsupported methods and redacts delivery errors', async () => {
  const deliver = vi.fn(async () => {
    throw Error('secret');
  });
  const listener = createProductionDeliveryListener({
    executionOrigin: 'https://output.runtime.test',
    deliver,
  });
  listener.server.listen(0, '127.0.0.1');
  await once(listener.server, 'listening');
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect(
      (await send(address.port, '/resource/a/app.js', { host: 'evil.test' }))
        .status
    ).toBe(404);
    expect((await send(address.port, '//evil.test/resource/a')).status).toBe(
      404
    );
    expect(
      (await send(address.port, '/resource/a/app.js', { method: 'POST' }))
        .status
    ).toBe(404);
    expect(deliver).not.toHaveBeenCalled();
    const response = await send(address.port, '/resource/a/app.js');
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('secret');
    expect(response.headers['cache-control']).toBe('no-store');
  } finally {
    await listener.close();
  }
});
