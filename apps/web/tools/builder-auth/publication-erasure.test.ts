// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeEach(async () => {
  f = await publicationFixture();
}, 30000);
afterEach(async () => {
  await f?.close();
});

it.each([
  'account',
  'merchant',
  'connection',
] as const)('erases publication state when its %s is deleted, preserving unrelated history', async (parent) => {
  const intent = await f.request();
  const intentId = intent.intentId as string;
  const renderProof = await f.proof(intentId);
  const receipt = await f.owner((c) =>
    f.run<{ receiptId: string; publishedVersion: string }>(
      c,
      'builder_confirm_publication',
      [intentId, renderProof]
    )
  );
  await f.proof(
    intentId,
    'delivery',
    receipt.receiptId,
    receipt.publishedVersion
  );
  // A second actor/connection/store has independent pending approval history.
  const unrelated = await f.pool.query<{ id: string }>(
    `INSERT INTO auth.users VALUES(gen_random_uuid()) RETURNING id`
  );
  const otherActor = unrelated.rows[0].id;
  const otherConnection = (
    await f.pool.query<{ id: string }>(
      `INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,expires_at) VALUES(gen_random_uuid(),$1,gen_random_uuid()::text,ARRAY['storefront.read'],now()+interval '1 hour') RETURNING id`,
      [otherActor]
    )
  ).rows[0].id;
  const otherMerchant = (
    await f.pool.query<{ id: string }>(
      `INSERT INTO merchants(id,user_id,business_name,slug) VALUES(gen_random_uuid(),$1,'Other','other-erasure') RETURNING id`,
      [otherActor]
    )
  ).rows[0].id;
  await f.pool.query(
    `INSERT INTO builder_authorization.publication_intents(actor_user_id,connection_id,grant_version,merchant_id,source_version,retry_key,config,destination_url,effect_digest,input_digest) SELECT $1,$2,1,$3,source_version,gen_random_uuid(),config,'https://other-erasure.usebaci.com',effect_digest,input_digest FROM builder_authorization.publication_intents WHERE id=$4`,
    [otherActor, otherConnection, otherMerchant, intentId]
  );
  if (parent === 'merchant') {
    // These minimal legacy fixture tables omit production's deletion cascades.
    // Remove only their synthetic rows so this test isolates the new builder FKs.
    await f.pool.query(
      'DELETE FROM page_config_history; DELETE FROM products; DELETE FROM merchant_feature_settings; DELETE FROM merchant_verifications; DELETE FROM domains; DELETE FROM ai_jobs; DELETE FROM page_configs'
    );
    await f.pool.query('DELETE FROM merchants WHERE id=$1', [f.merchantId]);
  } else if (parent === 'account') {
    await f.pool.query('DELETE FROM auth.users WHERE id=$1', [f.actor]);
  } else {
    await f.pool.query(
      'DELETE FROM builder_authorization.connections WHERE id=$1',
      [f.connection]
    );
  }
  for (const table of [
    'publication_intents',
    'publication_receipts',
    'publication_outbox',
    'publication_audit',
  ]) {
    const result = await f.pool.query(
      `SELECT count(*)::int n FROM builder_authorization.${table} WHERE actor_user_id=$1`,
      [f.actor]
    );
    expect(result.rows[0].n).toBe(0);
  }
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_checks'
      )
    ).rows[0].n
  ).toBe(0);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_intents WHERE actor_user_id=$1',
        [otherActor]
      )
    ).rows[0].n
  ).toBe(1);
  expect(
    (
      await f.pool.query(
        "SELECT has_table_privilege('authenticated','builder_authorization.publication_audit','DELETE') allowed"
      )
    ).rows[0].allowed
  ).toBe(false);
}, 30000);
