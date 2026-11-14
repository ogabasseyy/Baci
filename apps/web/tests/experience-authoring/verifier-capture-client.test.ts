import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createVerifierCaptureClient } from '../../tools/experience-verifier/capture-client';
import { createVerifierCaptureHandler } from '../../tools/experience-verifier/capture-handler';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

const id = '11111111-1111-4111-8111-111111111111';
const key = new Uint8Array(32).fill(7);
it('returns owner-bound capture metadata through the signed loopback boundary', async () => {
  const user = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  const worker = vi.fn(async () => ({
    evidenceId: id,
    buildId: id,
    buildDigest: 'a'.repeat(64),
    previewUrl: `https://builder.baci.test/builder/experience/preview?merchant=${id}&build=${id}&routeId=home`,
  }));
  const handler = createVerifierCaptureHandler({
    key,
    consumeNonce: async () => true,
    resolveUserClient: async () => user as never,
    resolveWorker: async () => worker as never,
  });
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 404 }),
    0,
    undefined,
    handler
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const client = createVerifierCaptureClient({
      key,
      port: address.port,
      previewOrigin: 'https://builder.baci.test',
      resolveLinkedAccessToken: async () => 'synthetic.token',
    });
    const ctx = {
      merchantId: id,
      supabase: user as never,
      identity: {
        actorUserId: id,
        connectionId: id,
        grantVersion: 1,
        scopes: new Set(['storefront.write' as const]),
        allowedMerchantIds: [id],
        allowCreateStore: false,
      },
    };
    await expect(
      client(ctx, { buildId: id, routeId: 'home', idempotencyKey: id })
    ).resolves.toMatchObject({ evidenceId: id, buildId: id });
    expect(worker).toHaveBeenCalledOnce();
    worker.mockResolvedValueOnce({
      evidenceId: id,
      buildId: id,
      buildDigest: 'a'.repeat(64),
      previewUrl: 'https://evil.test/',
    });
    await expect(
      client(ctx, { buildId: id, routeId: 'home', idempotencyKey: id })
    ).rejects.toThrow('VERIFIER_UNAVAILABLE');
  } finally {
    await listener.close();
  }
});
