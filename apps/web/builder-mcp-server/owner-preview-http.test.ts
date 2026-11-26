// @vitest-environment node

import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { serializeExperienceOwnerWireMessage } from '../src/schemas/experience-owner-wire';
import { createOwnerAdmission } from './owner-admission';
import { createOwnerPreviewHttpHandler as createProductionOwnerPreviewHttpHandler } from './owner-preview-http';

import {
  createOwnerPreviewHttpHandler,
  send,
} from './owner-preview-http.test-support';

function previewBody(nonce: string) {
  return serializeExperienceOwnerWireMessage('owner-preview/v1', {
    version: 1,
    nonce,
    expiresAt: Date.now() + 30000,
    accessToken: 'synthetic.token',
    input: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      buildId: '22222222-2222-4222-8222-222222222222',
      routeId: 'home',
    },
  });
}

it('fails closed when a direct transport has no admission configured', async () => {
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createProductionOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(401);
    expect(bridge).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects a forged signed request before dispatching bridge work', async () => {
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createOwnerPreviewHttpHandler(bridge, { admit: () => false });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(401);
    expect(bridge).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects forged requests without consuming the authenticated work slots', async () => {
  const key = Buffer.alloc(32, 9);
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const body = previewBody('d'.repeat(64));
  const signature = createHmac('sha256', key)
    .update(`owner-preview/v1\n${body}`)
    .digest('hex');
  try {
    for (let i = 0; i < 20; i++)
      expect((await send(address.port, { body })).status).toBe(401);
    expect((await send(address.port, { body, signature })).status).toBe(200);
    expect((await send(address.port, { body, signature })).status).toBe(401);
    expect(bridge).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects concurrent signed replays while the original work is still active', async () => {
  const key = Buffer.alloc(32, 8);
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const bridge = vi.fn(async () => {
    entered();
    await gate;
    return Response.json({ ok: true });
  });
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const body = previewBody('e'.repeat(64));
  const signature = createHmac('sha256', key)
    .update(`owner-preview/v1\n${body}`)
    .digest('hex');
  const original = send(address.port, { body, signature });
  try {
    await started;
    const replies = await Promise.all(
      Array.from({ length: 20 }, () => send(address.port, { body, signature }))
    );
    expect(
      replies.every(
        (response) => response.status === 401 || response.status === 429
      )
    ).toBe(true);
    expect(replies.some((response) => response.status === 401)).toBe(true);
    expect(bridge).toHaveBeenCalledOnce();
    release();
    expect((await original).status).toBe(200);
  } finally {
    release();
    await original.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not consume a valid nonce when all work slots are full', async () => {
  const key = Buffer.alloc(32, 6);
  let release = () => {};
  let notify = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const full = new Promise<void>((resolve) => {
    notify = resolve;
  });
  let active = 0;
  const bridge = vi.fn(async () => {
    active++;
    if (active === 16) notify();
    await gate;
    return Response.json({ ok: true });
  });
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const signed = (i: number) => {
    const body = previewBody(i.toString(16).padStart(64, '0'));
    return {
      body,
      signature: createHmac('sha256', key)
        .update(`owner-preview/v1\n${body}`)
        .digest('hex'),
    };
  };
  const inFlight: ReturnType<typeof send>[] = [];
  const overflow = signed(16);
  try {
    for (let i = 0; i < 16; i++) {
      inFlight.push(send(address.port, signed(i)));
      await vi.waitFor(() => expect(active).toBe(i + 1));
    }
    await full;
    expect((await send(address.port, overflow)).status).toBe(429);
    release();
    await Promise.all(inFlight);
    expect((await send(address.port, overflow)).status).toBe(200);
  } finally {
    release();
    await Promise.allSettled(inFlight);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);

it('forwards only the fixed owner preview path, signed body and no browser cookies', async () => {
  const bridge = vi.fn(async (r: Request) => {
    expect(r.url).toBe(
      'https://owner.baci-internal.invalid/internal/owner/preview'
    );
    expect(r.headers.get('x-baci-owner-signature')).toBe('a'.repeat(64));
    expect(r.headers.get('cookie')).toBeNull();
    expect(await r.text()).toBe('{}');
    return Response.json(
      { ok: true },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  });
  const handler = createOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port, { cookie: 'private=1' })).status).toBe(
      200
    );
    expect((await send(address.port, { host: 'evil.test' })).status).toBe(404);
    expect(
      (await send(address.port, { path: '/internal/owner/preview?x=1' })).status
    ).toBe(404);
    expect((await send(address.port, { method: 'GET' })).status).toBe(404);
    expect((await send(address.port, { body: 'x'.repeat(17000) })).status).toBe(
      413
    );
    expect(bridge).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects missing and malformed signatures before dispatch and reports bridge failures', async () => {
  const bridge = vi.fn(async () => {
    throw Error('bridge unavailable');
  });
  const handler = createOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port, { signature: null })).status).toBe(401);
    expect((await send(address.port, { signature: 'invalid' })).status).toBe(
      401
    );
    expect(bridge).not.toHaveBeenCalled();
    expect((await send(address.port)).status).toBe(502);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
