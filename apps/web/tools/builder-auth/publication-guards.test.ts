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
const counts = async () =>
  (
    await f.pool.query(
      'SELECT (SELECT count(*) FROM builder_authorization.publication_receipts)::int receipts,(SELECT count(*) FROM builder_authorization.publication_outbox)::int outbox,(SELECT count(*) FROM builder_authorization.publication_audit)::int audit,(SELECT is_published FROM merchants LIMIT 1) live'
    )
  ).rows[0];
it('fails closed on expired, consumed, forged render, revoked and changed-scope approvals', async () => {
  const result = await f.request();
  const id = result.intentId as string;
  const proof = await f.proof(id);
  await f.pool.query(
    "UPDATE builder_authorization.publication_intents SET issued_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
    [id]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('APPROVAL_EXPIRED');
  await f.pool.query(
    "UPDATE builder_authorization.publication_intents SET issued_at=now(),expires_at=now()+interval '10 minutes',consumed_at=now() WHERE id=$1",
    [id]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('APPROVAL_ALREADY_USED');
  await f.pool.query(
    'UPDATE builder_authorization.publication_intents SET consumed_at=NULL WHERE id=$1',
    [id]
  );
  await expect(
    f.owner((c) =>
      c.query(
        "INSERT INTO builder_authorization.publication_checks(id,intent_id,kind,version,effect_digest) SELECT $1,id,'render','draft:'||source_version,effect_digest FROM builder_authorization.publication_intents WHERE id=$2",
        [randomUUID(), id]
      )
    )
  ).rejects.toThrow('permission denied');
  await f.providerPool.query(
    "UPDATE builder_authorization.connections SET scopes=ARRAY['storefront.read'] WHERE id=$1",
    [f.connection]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('INSUFFICIENT_SCOPE');
  await f.providerPool.query(
    "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
    [f.connection]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('CONNECTION_REVOKED');
  expect(await counts()).toMatchObject({
    receipts: 0,
    outbox: 0,
    audit: 0,
    live: false,
  });
});
it('rejects another owner, a changed destination and tampered effect/policy without publication', async () => {
  const result = await f.request();
  const id = result.intentId as string;
  const proof = await f.proof(id);
  await f.pool.query(
    "UPDATE builder_authorization.publication_intents SET effect_digest=repeat('f',64) WHERE id=$1",
    [id]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('APPROVAL_MISMATCH');
  await f.pool.query(
    "UPDATE builder_authorization.publication_intents SET effect_digest=builder_authorization.publication_digest(config,source_version,destination_url),destination_url='https://other.usebaci.com' WHERE id=$1",
    [id]
  );
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('APPROVAL_MISMATCH');
  await expect(
    f.pool.query(
      "UPDATE builder_authorization.publication_intents SET policy_namespace='baci.connector' WHERE id=$1",
      [id]
    )
  ).rejects.toThrow();
  const other = randomUUID();
  await f.pool.query('INSERT INTO auth.users VALUES($1)', [other]);
  await f.pool.query('UPDATE merchants SET user_id=$1 WHERE id=$2', [
    other,
    f.merchantId,
  ]);
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('NOT_FOUND');
  expect(await counts()).toMatchObject({
    receipts: 0,
    outbox: 0,
    audit: 0,
    live: false,
  });
});
it('blocks a stale homepage or second-page draft and rejects changed retry input', async () => {
  const expected = await f.version();
  const result = await f.request();
  const id = result.intentId as string;
  const proof = await f.proof(id);
  await f.pool.query(
    "INSERT INTO page_configs(merchant_id,page_slug,page_name) VALUES($1,'about','About')",
    [f.merchantId]
  );
  const stale = await f.owner((c) =>
    f.run(c, 'builder_confirm_publication', [id, proof])
  );
  expect(stale).toMatchObject({ code: 'STALE_DRAFT' });
  await expect(f.request(f.key, `draft:${randomUUID()}`)).rejects.toThrow(
    'IDEMPOTENCY_CONFLICT'
  );
  expect(await counts()).toMatchObject({ receipts: 0, live: false });
  expect(await f.version()).not.toBe(expected);
});
it('returns real launch blockers and leaves the intent unconsumed', async () => {
  await f.pool.query("UPDATE merchants SET country='NG' WHERE id=$1", [
    f.merchantId,
  ]);
  await f.pool.query(
    "UPDATE products SET status='draft' WHERE merchant_id=$1",
    [f.merchantId]
  );
  const result = await f.request();
  const id = result.intentId as string;
  const proof = await f.proof(id);
  const blocked = await f.owner((c) =>
    f.run(c, 'builder_confirm_publication', [id, proof])
  );
  expect(blocked).toMatchObject({
    status: 'blocked',
    missingItems: expect.arrayContaining([
      'Identity verification (NIN, BVN, or CAC)',
    ]),
  });
  expect(
    (
      await f.pool.query(
        'SELECT consumed_at FROM builder_authorization.publication_intents WHERE id=$1',
        [id]
      )
    ).rows[0].consumed_at
  ).toBeNull();
  expect(await counts()).toMatchObject({ receipts: 0, live: false });
});
