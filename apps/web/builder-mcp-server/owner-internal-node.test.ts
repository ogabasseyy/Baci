import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createBuilderMcpNodeServer } from './node';
import { createOwnerInternalNodeServer } from './owner-internal-node';

async function post(port: number, path: string) {
  return await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          host: 'mcp.usebaci.com',
          'content-type': 'application/json',
          'x-baci-owner-signature': 'a'.repeat(64),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end('{}');
  });
}

it('separates owner routes when explicitly composed on distinct local listeners', async () => {
  const owner = vi.fn(async () => Response.json({ ok: true }));
  const publicListener = createBuilderMcpNodeServer();
  const internalListener = createOwnerInternalNodeServer({
    ownerPreview: owner,
  });
  publicListener.server.listen(0, '127.0.0.1');
  const publicReady = once(publicListener.server, 'listening');
  const internalPort = await internalListener.listen(0);
  await publicReady;
  const publicAddress = publicListener.server.address();
  if (!publicAddress || typeof publicAddress === 'string')
    throw Error('fixture');
  try {
    expect(await post(publicAddress.port, '/internal/owner/preview')).toBe(404);
    expect(owner).not.toHaveBeenCalled();
    expect(await post(internalPort, '/builder/mcp')).toBe(404);
    expect(await post(internalPort, '/internal/owner/attest')).toBe(404);
    expect(await post(internalPort, '/internal/owner/preview')).toBe(200);
    expect(owner).toHaveBeenCalledOnce();
  } finally {
    await Promise.all([publicListener.close(), internalListener.close()]);
  }
});

it('refuses to start an owner listener without any installed handler', () => {
  expect(() => createOwnerInternalNodeServer({})).toThrow(
    'OWNER_TRANSPORT_NOT_CONFIGURED'
  );
});

it('rejects invalid ports without binding', async () => {
  const listener = createOwnerInternalNodeServer({
    ownerPreview: async () => new Response(null, { status: 204 }),
  });
  await expect(listener.listen(-1)).rejects.toThrow('INVALID_OWNER_PORT');
  await listener.close();
});

it('waits for admitted owner work to settle during shutdown', async () => {
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const listener = createOwnerInternalNodeServer({
    ownerPreview: async () => {
      entered();
      await gate;
      return Response.json({ ok: true });
    },
  });
  const port = await listener.listen(0);
  const requestDone = post(port, '/internal/owner/preview').catch(() => 0);
  await started;
  let closed = false;
  const closing = listener.close().then(() => {
    closed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
  } finally {
    release();
    await closing;
    await requestDone;
  }
});
