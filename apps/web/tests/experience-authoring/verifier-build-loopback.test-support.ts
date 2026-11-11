import type { Pool } from 'pg';
import type { OwnerRequestContext } from '@/lib/experience/authorization';
import { createVerifierBuildClient } from '../../tools/experience-verifier/build-client';
import { createVerifierBuildHandler } from '../../tools/experience-verifier/build-handler';
import type { createIndependentBuildVerifier } from '../../tools/experience-verifier/build-verifier';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierNonceStore } from '../../tools/experience-verifier/nonce-store';
import type { experienceDataFixture } from './data-fixture.test-support';

export async function setupBuildVerification(input: {
  f: Awaited<ReturnType<typeof experienceDataFixture>>;
  pool: Pool;
  key: Uint8Array;
  verify: ReturnType<typeof createIndependentBuildVerifier>;
}) {
  const handler = createVerifierBuildHandler({
    key: input.key,
    consumeNonce: await createVerifierNonceStore(input.pool),
    resolveUserClient: (token) =>
      token === input.f.owner.accessToken
        ? Promise.resolve(input.f.owner.supabase)
        : Promise.reject(Error('INVALID_TOKEN')),
    verify: input.verify,
  });
  const listener = await startVerifierListener(
    () => Promise.resolve(new Response(null, { status: 404 })),
    0,
    handler
  );
  const address = listener.server.address();
  if (!address || typeof address === 'string') {
    await listener.close();
    throw Error('NO_VERIFIER');
  }
  const identity = {
    actorUserId: input.f.actorId,
    connectionId: input.f.connectionId,
    grantVersion: 1,
    scopes: new Set(['storefront.read', 'storefront.write'] as const),
    allowedMerchantIds: [input.f.merchantId],
    allowCreateStore: false,
  };
  const ctx: OwnerRequestContext = { ...input.f.owner, identity };
  return {
    ctx,
    client: createVerifierBuildClient({
      key: input.key,
      port: address.port,
      resolveLinkedAccessToken: async () => input.f.owner.accessToken,
    }),
    close: () => listener.close(),
  };
}
