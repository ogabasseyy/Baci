import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierAttestationHandler } from '../../tools/experience-verifier/attestation-handler';

const key = new Uint8Array(32).fill(7);
const now = 1700000000000;
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const user = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
  };
  const attest = vi.fn(async () => {});
  const seen = new Set<string>();
  const handler = createVerifierAttestationHandler({
    key,
    now: () => now,
    consumeNonce: async (nonce) => {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
    resolveUserClient: async () => user as never,
    attest,
  });
  const body = JSON.stringify({
    version: 1,
    nonce: 'a'.repeat(64),
    expiresAt: now + 30000,
    accessToken: 'synthetic.token',
    approvalId: id,
    kind: 'draft',
  });
  const signature = createHmac('sha256', key)
    .update(`verifier-attest/v1\n${body}`)
    .digest('hex');
  const request = (overrides?: {
    body?: string;
    signature?: string;
    url?: string;
  }) =>
    new Request(
      overrides?.url ?? 'https://verifier.baci-internal.invalid/v1/attest',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-verifier-signature': overrides?.signature ?? signature,
        },
        body: overrides?.body ?? body,
      }
    );
  return { handler, request, attest, user };
}
it('verifies a signed owner request and rejects durable nonce replay', async () => {
  const f = fixture();
  const response = await f.handler(f.request());
  expect(response.status).toBe(204);
  expect(f.user.auth.getUser).toHaveBeenCalledWith('synthetic.token');
  expect(f.attest).toHaveBeenCalledWith(f.user, id, 'draft');
  expect((await f.handler(f.request())).status).toBe(409);
  expect(f.attest).toHaveBeenCalledOnce();
});
it('rejects tampering, wrong path and unauthenticated owners before attestation', async () => {
  const f = fixture();
  expect(
    (await f.handler(f.request({ signature: '0'.repeat(64) }))).status
  ).toBe(401);
  expect(
    (
      await f.handler(
        f.request({ url: 'https://verifier.baci-internal.invalid/v1/other' })
      )
    ).status
  ).toBe(404);
  f.user.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: null,
  } as never);
  expect((await f.handler(f.request())).status).toBe(403);
  expect(f.attest).not.toHaveBeenCalled();
});
