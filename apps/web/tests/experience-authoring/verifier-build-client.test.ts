import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierBuildClient } from '../../tools/experience-verifier/build-client';
import { createVerifierBuildHandler } from '../../tools/experience-verifier/build-handler';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

const id = '11111111-1111-4111-8111-111111111111';
const key = new Uint8Array(32).fill(7);
const receipt = {
  merchantId: id,
  jobId: id,
  attemptNonce: id,
  buildDigest: 'b'.repeat(64),
  receiptDigest: 'c'.repeat(64),
  hostOrigin: 'https://shop.synthetic.test',
};
it('revalidates owner access and sends only identifiers to the fixed verifier port', async () => {
  const user = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  const verify = vi.fn(async () => {});
  const handler = createVerifierBuildHandler({
    key,
    consumeNonce: async () => true,
    resolveUserClient: async () => user as never,
    verify,
  });
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 404 }),
    0,
    handler
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const resolveToken = vi.fn(async () => 'synthetic.token');
    const client = createVerifierBuildClient({
      key,
      port: address.port,
      resolveLinkedAccessToken: resolveToken,
    });
    const identity = {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.write' as const]),
      allowedMerchantIds: [id],
      allowCreateStore: false,
    };
    const ctx = {
      merchantId: id,
      supabase: user as never,
      identity,
      actorUserId: id,
    };
    await client(receipt, ctx);
    expect(verify).toHaveBeenCalledOnce();
    expect(resolveToken).toHaveBeenCalledWith(identity);
    expect(user.rpc).toHaveBeenCalledTimes(2);
    await expect(
      client(
        { ...receipt, merchantId: '22222222-2222-4222-8222-222222222222' },
        ctx
      )
    ).rejects.toThrow();
    expect(verify).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
  }
});
