import { request } from 'node:http';
import { SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerAdmission } from '../../builder-mcp-server/owner-admission';
import { createOwnerInternalNodeServer } from '../../builder-mcp-server/owner-internal-node';
import { createVerifierPublicClient } from '../../src/lib/experience/verifier-public-client';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';
import { createPublicVerificationHandler } from '../../tools/experience-verifier/public-verification-handler';

it('forwards a signed public-verification request over loopback and reauthenticates the synthetic owner', async () => {
  const key = Buffer.alloc(32, 7);
  const approvalId = '11111111-1111-4111-8111-111111111111';
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(approvalId)
    .sign(key);
  const owner = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: token } },
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
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  const ownerListener = createOwnerInternalNodeServer({
    ownerPublicVerificationAdmission: createOwnerAdmission(
      key,
      'verifier-public/v1'
    ),
    ownerPublicVerification: createVerifierLoopbackForwarder(
      address.port,
      'public'
    ),
  });
  const ownerPort = await ownerListener.listen(0);
  try {
    const client = createVerifierPublicClient({
      key,
      fetch: async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: ownerPort,
              path: '/internal/owner/public',
              method: 'POST',
              headers: {
                ...(init?.headers as Record<string, string>),
                host: 'owner.baci-internal.invalid',
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
    expect(verify).toHaveBeenCalledWith(
      owner,
      approvalId,
      expect.any(AbortSignal)
    );
    expect(owner.auth.getUser).toHaveBeenCalledTimes(2);
  } finally {
    await ownerListener.close();
    await listener.close();
  }
}, 15000);
