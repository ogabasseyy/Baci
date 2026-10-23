// @vitest-environment node
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { BuilderContext } from '../../src/lib/builder-connector/types';
import { confirmStorefrontPublication } from '../../src/lib/website-builder/commit-publication';
import { loadPublishConfirmation } from '../../src/lib/website-builder/load-publication';
import { requestStorefrontPublication } from '../../src/lib/website-builder/publish-intent';
import { getStorefrontStatus } from '../../src/lib/website-builder/read-storefront';
import { retryCommittedDelivery } from '../../src/lib/website-builder/retry-delivery';
import { createPublicationProofWriter } from './publication-proof';
import { publicationRlsClient } from './publication-rls-client';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
let verifier: Pool;
beforeAll(async () => {
  f = await publicationFixture();
  verifier = new Pool({
    ...f.pool.options,
    options: '-c role=baci_builder_publication_verifier',
  });
}, 30000);
afterAll(async () => {
  await verifier?.end();
  await f?.close();
});
it('runs request → exact owner preview → confirmed commit → failed delivery → new owner-session retry without republishing', async () => {
  const client = publicationRlsClient(f.actor, f.owner);
  const proof = createPublicationProofWriter(verifier);
  const ctx: BuilderContext = {
    supabase: client as BuilderContext['supabase'],
    merchantId: f.merchantId,
    identity: {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      scopes: new Set(['storefront.read', 'storefront.publish']),
      allowedMerchantIds: [f.merchantId],
      allowCreateStore: false,
    },
  };
  const version = await f.version();
  const request = await requestStorefrontPublication(ctx, {
    storefrontId: f.merchantId,
    expectedVersion: version,
    idempotencyKey: f.key,
  });
  expect(request.status).toBe('approval_required');
  if (request.status !== 'approval_required') throw Error('Missing intent');
  const view = await loadPublishConfirmation(client, request.intentId);
  expect(view).toMatchObject({
    kind: 'approval',
    canConfirm: true,
    version,
    preview: {
      version,
      projection: {
        identity: { business_name: 'Approval Fixture' },
        inert: true,
      },
    },
  });
  const committed = await confirmStorefrontPublication(
    client,
    request.intentId,
    proof
  );
  expect(committed.status).toBe('verifying');
  if (committed.status !== 'verifying') throw Error('Missing receipt');
  expect((await getStorefrontStatus(ctx)).latestReceipt).toMatchObject({
    status: 'verifying',
    receiptId: committed.receiptId,
  });
  const failed = await retryCommittedDelivery(client, committed.receiptId, {
    ...proof,
    evict: vi.fn().mockRejectedValue(Error('cache unavailable')),
    probe: vi.fn(),
  });
  expect(failed.status).toBe('verifying');
  await f.providerPool.query(
    "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
    [f.connection]
  );
  await f.pool.query(
    "UPDATE builder_authorization.publication_outbox SET next_attempt_at=now()-interval '1 minute'"
  );
  const probe = vi.fn().mockResolvedValue(true);
  const resumed = await retryCommittedDelivery(
    publicationRlsClient(f.actor, f.owner),
    committed.receiptId,
    { ...proof, evict: async () => {}, probe }
  );
  expect(resumed.status).toBe('live');
  expect(probe).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId: f.merchantId,
      publishedVersion: committed.publishedVersion,
      contentDigest: expect.stringMatching(/^home-v1:/),
    })
  );
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(1);
});
