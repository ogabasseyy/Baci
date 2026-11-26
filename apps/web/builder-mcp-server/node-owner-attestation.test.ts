// @vitest-environment node
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createOwnerInternalNodeServer } from './owner-internal-node';
import { createOwnerAttestationHttpHandler } from './owner-preview-http';

it('routes signed attestation only when explicitly installed', async () => {
  const ownerAttestation = vi.fn(async (req: Request) => {
    expect(req.url).toBe('https://verifier.baci-internal.invalid/v1/attest');
    expect(req.headers.get('x-baci-verifier-signature')).toBe('a'.repeat(64));
    expect(req.headers.get('cookie')).toBeNull();
    return new Response(null, { status: 204 });
  });
  const runtime = createOwnerInternalNodeServer({
    ownerAttestation,
    ownerAttestationAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
  });
  const port = await runtime.listen(0);
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/internal/owner/attest',
          method: 'POST',
          headers: {
            host: 'owner.baci-internal.invalid',
            'content-type': 'application/json',
            'x-baci-verifier-signature': 'a'.repeat(64),
            cookie: 'secret=never-forward',
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
    expect(status).toBe(204);
    expect(ownerAttestation).toHaveBeenCalledOnce();
  } finally {
    await runtime.close();
  }
});

it('does not treat the request-body timeout as a completed attestation response deadline', async () => {
  const ownerAttestation = vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return new Response(null, { status: 204 });
  });
  const handler = createOwnerAttestationHttpHandler(
    ownerAttestation,
    (_body, _signature, reserve) => reserve?.('synthetic-owner') ?? false
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  const runtime = {
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
  runtime.server.requestTimeout = 25;
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  const address = runtime.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/internal/owner/attest',
          method: 'POST',
          headers: {
            host: 'owner.baci-internal.invalid',
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
    expect(status).toBe(204);
    expect(ownerAttestation).toHaveBeenCalledOnce();
  } finally {
    await runtime.close();
  }
});
