// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeEach(async () => {
  f = await publicationFixture();
}, 30000);
afterEach(async () => {
  await f?.close();
});
async function commit() {
  const intent = await f.request();
  const id = intent.intentId as string;
  const proof = await f.proof(id);
  const result = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_confirm_publication', [
      id,
      proof,
    ])
  );
  return { id, result, receipt: result.receiptId as string };
}
it('requires real independent delivery evidence; failure never republishes or unpublishes', async () => {
  const { id, result, receipt } = await commit();
  const claim = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_claim_publication_delivery', [
      receipt,
    ])
  );
  expect(claim.leaseId).toBeDefined();
  const failed = await f.owner((c) =>
    f.run(c, 'builder_finish_publication_delivery', [
      receipt,
      claim.leaseId,
      randomUUID(),
    ])
  );
  expect(failed).toMatchObject({ status: 'verifying' });
  expect(
    (await f.pool.query('SELECT is_published FROM merchants')).rows[0]
      .is_published
  ).toBe(true);
  await f.pool.query(
    "UPDATE builder_authorization.publication_outbox SET next_attempt_at=now()-interval '1 minute'"
  );
  const next = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_claim_publication_delivery', [
      receipt,
    ])
  );
  const proof = await f.proof(
    id,
    'delivery',
    receipt,
    result.publishedVersion as string
  );
  const live = await f.owner((c) =>
    f.run(c, 'builder_finish_publication_delivery', [
      receipt,
      next.leaseId,
      proof,
    ])
  );
  expect(live).toMatchObject({
    status: 'live',
    publicUrl: 'https://approval-fixture.usebaci.com',
  });
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(1);
});
it('owner retry works after ChatGPT revocation, but connection replay does not', async () => {
  const { id, result, receipt } = await commit();
  await f.providerPool.query(
    "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
    [f.connection]
  );
  await expect(
    f.owner((c) =>
      f.run(c, 'builder_get_publication_receipt', [receipt, f.connection, 1])
    )
  ).rejects.toThrow('CONNECTION_REVOKED');
  const claim = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_claim_publication_delivery', [
      receipt,
    ])
  );
  const proof = await f.proof(
    id,
    'delivery',
    receipt,
    result.publishedVersion as string
  );
  expect(
    await f.owner((c) =>
      f.run(c, 'builder_finish_publication_delivery', [
        receipt,
        claim.leaseId,
        proof,
      ])
    )
  ).toMatchObject({ status: 'live' });
});
it('native/browser publication or unpublish supersedes even a previously live receipt without a new plugin receipt', async () => {
  const { id, result, receipt } = await commit();
  const claim = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_claim_publication_delivery', [
      receipt,
    ])
  );
  const proof = await f.proof(
    id,
    'delivery',
    receipt,
    result.publishedVersion as string
  );
  await f.owner((c) =>
    f.run(c, 'builder_finish_publication_delivery', [
      receipt,
      claim.leaseId,
      proof,
    ])
  );
  await f.pool.query(
    "UPDATE page_configs SET published_config=jsonb_set(published_config,'{root,props,title}','\"Native change\"') WHERE merchant_id=$1 AND page_slug='home'",
    [f.merchantId]
  );
  const changed = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_get_publication_receipt', [
      receipt,
      f.connection,
      1,
    ])
  );
  expect(changed.status).toBe('superseded');
  expect(changed.currentPublishedVersion).not.toBe(result.publishedVersion);
  expect(changed).not.toHaveProperty('supersededByReceiptId');
  await f.pool.query('UPDATE merchants SET is_published=false WHERE id=$1', [
    f.merchantId,
  ]);
  expect(
    await f.owner((c) =>
      f.run(c, 'builder_get_publication_receipt', [receipt, f.connection, 1])
    )
  ).toMatchObject({ status: 'superseded', currentPublishedVersion: null });
});
it('exact committed retry resolves current state after expiry, consumed nonce and later draft edits', async () => {
  const expected = await f.version();
  const { id, result } = await commit();
  await f.pool.query(
    "UPDATE builder_authorization.publication_intents SET issued_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
    [id]
  );
  await f.pool.query(
    "UPDATE builder_page_drafts SET draft_config=jsonb_set(draft_config,'{root,props,title}','\"Later draft\"') WHERE merchant_id=$1",
    [f.merchantId]
  );
  expect(await f.request(f.key, expected)).toEqual(result);
  expect(
    await f.owner((c) => f.run(c, 'builder_confirm_publication', [id, null]))
  ).toEqual(result);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_audit'
      )
    ).rows[0].n
  ).toBe(1);
});
