import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { BUILDER_MCP_HOST } from '../src/lib/builder-connector/resource';
import { createBuilderMcpNodeServer } from './node';
import { createOwnerInternalNodeServer } from './owner-internal-node';

async function post(
  port: number,
  path: string,
  authority = 'owner.baci-internal.invalid'
) {
  return await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          host: authority,
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
    ownerPreviewAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
  });
  publicListener.server.listen(0, '127.0.0.1');
  const publicReady = once(publicListener.server, 'listening');
  const internalPort = await internalListener.listen(0);
  await publicReady;
  const publicAddress = publicListener.server.address();
  if (!publicAddress || typeof publicAddress === 'string')
    throw Error('fixture');
  try {
    expect(await post(publicAddress.port, '/internal/owner/preview')).toBe(403);
    expect(
      await post(
        publicAddress.port,
        '/internal/owner/preview',
        BUILDER_MCP_HOST
      )
    ).toBe(404);
    expect(
      await post(internalPort, '/internal/owner/preview', BUILDER_MCP_HOST)
    ).toBe(404);
    expect(
      await post(internalPort, '/internal/owner/preview', 'mcp.usebaci.com')
    ).toBe(404);
    expect(owner).not.toHaveBeenCalled();
    expect(await post(internalPort, '/builder/mcp')).toBe(404);
    expect(await post(internalPort, '/internal/owner/attest')).toBe(404);
    expect(await post(internalPort, '/internal/owner/preview')).toBe(200);
    expect(owner).toHaveBeenCalledOnce();
  } finally {
    await Promise.all([publicListener.close(), internalListener.close()]);
  }
});

it('routes signed public verification only through the owner listener', async () => {
  const verify = vi.fn(
    async (_request: Request) => new Response(null, { status: 204 })
  );
  const owner = createOwnerInternalNodeServer({
    ownerPublicVerification: verify,
    ownerPublicVerificationAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
  });
  const listener = createBuilderMcpNodeServer();
  listener.server.listen(0, '127.0.0.1');
  await once(listener.server, 'listening');
  const publicAddress = listener.server.address();
  if (!publicAddress || typeof publicAddress === 'string')
    throw Error('fixture');
  const port = await owner.listen(0);
  const send = (target: number, authority = 'owner.baci-internal.invalid') =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: target,
          path: '/internal/owner/public',
          method: 'POST',
          headers: {
            host: authority,
            'content-type': 'application/json',
            'x-baci-verifier-signature': 'a'.repeat(64),
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
  try {
    expect(await send(publicAddress.port, BUILDER_MCP_HOST)).toBe(404);
    expect(await send(port)).toBe(204);
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]?.[0].url).toBe(
      'https://verifier.baci-internal.invalid/v1/public'
    );
  } finally {
    await Promise.all([listener.close(), owner.close()]);
  }
});

it('refuses to start an owner listener without any installed handler', () => {
  expect(() => createOwnerInternalNodeServer({})).toThrow(
    'OWNER_TRANSPORT_NOT_CONFIGURED'
  );
});

it('refuses owner handlers when admission is missing', () => {
  const handler = async () => new Response(null, { status: 204 });
  expect(() =>
    createOwnerInternalNodeServer({ ownerPreview: handler })
  ).toThrow('OWNER_ADMISSION_REQUIRED');
  expect(() =>
    createOwnerInternalNodeServer({ ownerAttestation: handler })
  ).toThrow('OWNER_ADMISSION_REQUIRED');
  expect(() =>
    createOwnerInternalNodeServer({ ownerPublicVerification: handler })
  ).toThrow('OWNER_ADMISSION_REQUIRED');
});

it('rejects invalid ports without binding', async () => {
  const listener = createOwnerInternalNodeServer({
    ownerPreview: async () => new Response(null, { status: 204 }),
    ownerPreviewAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
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
    ownerPreviewAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
    ownerPreview: async () => {
      entered();
      await gate;
      return Response.json({ ok: true });
    },
  });
  const port = await listener.listen(0);
  const requestDone = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/internal/owner/preview',
          method: 'POST',
          headers: {
            host: 'owner.baci-internal.invalid',
            'content-type': 'application/json',
            'x-baci-owner-signature': 'a'.repeat(64),
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end('{}');
    }
  ).catch(() => ({ status: 0, body: '' }));
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
    expect(await requestDone).toEqual({ status: 200, body: '{"ok":true}' });
  }
});
