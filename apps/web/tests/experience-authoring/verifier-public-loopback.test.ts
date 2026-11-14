import { request } from 'node:http';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierPublicClient } from '../../src/lib/experience/verifier-public-client';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createPublicVerificationHandler } from '../../tools/experience-verifier/public-verification-handler';

it('forwards a signed public-verification request over loopback and reauthenticates the synthetic owner', async () => {
  const key = Buffer.alloc(32, 7);
  const approvalId = '11111111-1111-4111-8111-111111111111';
  const owner = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'synthetic.jwt.token' } },
        error: null,
      }),
      getUser: vi.fn(async () => ({
        data: { user: { id: approvalId } },
        error: null,
      })),
    },
  };
  const verify = vi.fn(async () => {});
  const used = new Set<string>();
  const handler = createPublicVerificationHandler({
    key,
    consumeNonce: async (nonce) => {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
    resolveUserClient: async () => owner as never,
    verify,
  });
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 404 }),
    0,
    undefined,
    undefined,
    handler
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const client = createVerifierPublicClient({
      key,
      fetch: async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/v1/public',
              method: 'POST',
              headers: {
                ...(init?.headers as Record<string, string>),
                host: 'verifier.baci-internal.invalid',
              },
            },
            (res) => {
              res.resume();
              res.on('end', () =>
                resolve(new Response(null, { status: res.statusCode ?? 500 }))
              );
            }
          );
          req.on('error', reject);
          req.end(String(init?.body ?? ''));
        }),
    });
    await client(owner as never, { approvalId });
    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith(owner, approvalId);
    expect(owner.auth.getUser).toHaveBeenCalledTimes(2);
  } finally {
    await listener.close();
  }
}, 15000);
