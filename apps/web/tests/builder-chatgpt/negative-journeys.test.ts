// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestStorefrontPublication } from '../../src/lib/website-builder/publish-intent';
import { queueStorefrontEdit } from '../../src/lib/website-builder/queue-edit';
import { retryCommittedDelivery } from '../../src/lib/website-builder/retry-delivery';
import { runStorefrontEdit } from '../../src/lib/website-builder/run-edit';
import { builderEditLeaseSchema } from '../../src/schemas/builder-edit-lease';
import { createLifecycleHarness } from './lifecycle.test-utils';

let h: Awaited<ReturnType<typeof createLifecycleHarness>>;
beforeEach(async () => {
  h = await createLifecycleHarness();
}, 30000);
afterEach(async () => {
  await h?.close();
});
const queue = async (key = randomUUID(), instructions = 'Change heading') =>
  queueStorefrontEdit(h.ctx, {
    storefrontId: h.merchantId,
    expectedVersion: await h.version(),
    idempotencyKey: key,
    pageSlug: 'home',
    instructions,
  });
it('wrong tenant cannot enqueue or publish', async () => {
  await expect(
    queueStorefrontEdit(h.ctx, {
      storefrontId: randomUUID(),
      expectedVersion: await h.version(),
      idempotencyKey: randomUUID(),
      pageSlug: 'home',
      instructions: 'Change heading',
    })
  ).rejects.toThrow();
  expect((await h.publicState()).is_published).toBe(false);
});
it('revoked connection rejects business operations', async () => {
  await h.providerPool.query(
    "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
    [h.connection]
  );
  await expect(queue()).rejects.toThrow();
});
it('expired linked authority cannot mutate', async () => {
  await h.providerPool.query(
    "UPDATE builder_authorization.connections SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [h.connection]
  );
  await expect(queue()).rejects.toThrow();
});
it('stale revision refuses a new mutation', async () => {
  const result = await queueStorefrontEdit(h.ctx, {
    storefrontId: h.merchantId,
    expectedVersion: `draft:${randomUUID()}`,
    idempotencyKey: randomUUID(),
    pageSlug: 'home',
    instructions: 'Change heading',
  });
  expect(result).toMatchObject({ status: 'error', code: 'STALE_DRAFT' });
});
it('duplicate payload reconciles one operation and changed payload conflicts', async () => {
  const key = randomUUID();
  const a = await queue(key);
  expect(await queue(key)).toEqual(a);
  await expect(queue(key, 'Different edit')).rejects.toThrow();
  expect(
    (
      await h.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.builder_edit_operations'
      )
    ).rows[0].n
  ).toBe(1);
});
it('unsafe generated config fails without application and expired leases recover', async () => {
  const q = await queue();
  if (q.status !== 'pending') throw Error('Expected queued edit');
  const args = [h.connection, 1, h.merchantId, q.operationId];
  const old = builderEditLeaseSchema.parse(
    await h.call('builder_claim_edit', args)
  );
  await h.pool.query(
    "UPDATE builder_authorization.builder_edit_operations SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
    [q.operationId]
  );
  const lease = builderEditLeaseSchema.parse(
    await h.call('builder_claim_edit', args)
  );
  expect(lease.leaseId).not.toBe(old.leaseId);
  const result = await runStorefrontEdit(h.ctx, lease, {
    rateLimit: () => ({ allowed: true }),
    generate: async () => ({
      status: 'proposed',
      summary: 'Unsafe',
      operations: [
        {
          kind: 'update_component',
          componentId: 'hero',
          patch: { componentType: 'Hero', ctaLink: 'javascript:alert(1)' },
        },
      ],
    }),
  });
  expect(result.status).toBe('failed');
  expect((await h.publicState()).is_published).toBe(false);
});
it('launch requirements block publication without visibility changes', async () => {
  await h.pool.query(
    'UPDATE merchant_feature_settings SET pay_on_delivery_enabled=false WHERE merchant_id=$1',
    [h.merchantId]
  );
  expect(
    await requestStorefrontPublication(h.ctx, {
      storefrontId: h.merchantId,
      expectedVersion: await h.version(),
      idempotencyKey: randomUUID(),
    })
  ).toMatchObject({ status: 'blocked', missingItems: ['Payment method'] });
  expect((await h.publicState()).is_published).toBe(false);
});
it('delivery failure stays verifying and later native publication supersedes without a second receipt', async () => {
  const result = await h.journey(false);
  if (result.receipt.status !== 'verifying') throw Error('Missing receipt');
  const deps = {
    evict: vi.fn().mockRejectedValue(Error('cache unavailable')),
    probe: vi.fn(),
    certifyDelivery: vi.fn(),
  };
  expect(
    await retryCommittedDelivery(h.client, result.receipt.receiptId, deps)
  ).toMatchObject({ status: 'verifying' });
  expect(deps.probe).not.toHaveBeenCalled();
  await h.pool.query(
    "UPDATE page_configs SET published_config=jsonb_build_object('native','new revision') WHERE merchant_id=$1",
    [h.merchantId]
  );
  expect(
    await retryCommittedDelivery(h.client, result.receipt.receiptId, deps)
  ).toMatchObject({ status: 'superseded' });
  expect(
    (
      await h.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(1);
});
