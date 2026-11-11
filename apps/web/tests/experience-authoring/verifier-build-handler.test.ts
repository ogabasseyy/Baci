import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierBuildHandler } from '../../tools/experience-verifier/build-handler';

const id = '11111111-1111-4111-8111-111111111111';
const key = new Uint8Array(32).fill(7);
const now = 1700000000000;
it('admits a signed owner-bound build once and never accepts source from the caller', async () => {
  const verify = vi.fn(async () => {});
  const user = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
  };
  const seen = new Set<string>();
  const handler = createVerifierBuildHandler({
    key,
    now: () => now,
    verify,
    resolveUserClient: async () => user as never,
    consumeNonce: async (nonce) => {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
  });
  const body = JSON.stringify({
    version: 1,
    nonce: 'a'.repeat(64),
    expiresAt: now + 30000,
    accessToken: 'synthetic.token',
    merchantId: id,
    jobId: id,
    attemptNonce: id,
    buildDigest: 'b'.repeat(64),
    receiptDigest: 'c'.repeat(64),
    hostOrigin: 'https://shop.synthetic.test',
  });
  const signature = createHmac('sha256', key)
    .update(`verifier-build/v1\n${body}`)
    .digest('hex');
  const req = () =>
    new Request('https://verifier.baci-internal.invalid/v1/build', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-baci-verifier-signature': signature,
      },
      body,
    });
  expect((await handler(req())).status).toBe(204);
  expect(verify).toHaveBeenCalledWith(
    { merchantId: id, supabase: user },
    expect.objectContaining({ jobId: id, buildDigest: 'b'.repeat(64) })
  );
  expect((await handler(req())).status).toBe(409);
  expect(verify).toHaveBeenCalledOnce();
});
