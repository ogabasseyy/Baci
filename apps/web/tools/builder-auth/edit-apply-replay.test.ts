// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { BuilderContext } from '../../src/lib/builder-connector/types';
import { applyStorefrontOperation } from '../../src/lib/website-builder/apply-edit';
import { asActor, editFixture } from './edit-fixture';
import { publicationRlsClient } from './publication-rls-client';

it('replays a lost stale outcome through prepare and apply under the normal role', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId as string;
    const lease = (await f.claim(id)).rows[0].result;
    await f.finish(id, lease.leaseId);
    await f.pool.query(
      "UPDATE merchants SET logo_url='https://example.test/new.png' WHERE id=$1",
      [f.merchant]
    );
    const client = publicationRlsClient(f.actor, async (fn) => {
      const c = await f.pool.connect();
      try {
        return await asActor(c, f.actor, () => fn(c));
      } finally {
        c.release();
      }
    });
    const ctx: BuilderContext = {
      supabase: client as BuilderContext['supabase'],
      merchantId: f.merchant,
      identity: {
        actorUserId: f.actor,
        connectionId: f.connection,
        grantVersion: 1,
        scopes: new Set(['storefront.read', 'storefront.write']),
        allowedMerchantIds: [f.merchant],
        allowCreateStore: false,
      },
    };
    const input = {
      storefrontId: f.merchant,
      operationId: id,
      expectedVersion: `draft:${f.version}`,
      idempotencyKey: randomUUID(),
    };
    const first = await applyStorefrontOperation(ctx, input);
    expect(first).toMatchObject({ status: 'error', code: 'STALE_DRAFT' });
    expect(await applyStorefrontOperation(ctx, input)).toEqual(first);
    await expect(
      applyStorefrontOperation(ctx, { ...input, idempotencyKey: randomUUID() })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  } finally {
    await f.close();
  }
}, 30000);
