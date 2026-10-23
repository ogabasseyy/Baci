import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asActor, draftFixture } from './draft-fixture.ts';

const input = {
  businessName: 'Fixture Store',
  businessType: 'electronics',
  country: 'NG',
  requestedSlug: 'fixture-store',
};
const config = {
  root: { props: { rendererVersion: 'baci-home-six-v1', title: 'Fixture' } },
  content: [],
};
test('provisioning preserves placeholders and primary hosts; rejects collisions atomically', async () => {
  const f = await draftFixture();
  const client = await f.pool.connect();
  try {
    async function owner() {
      const actor = randomUUID();
      const connection = randomUUID();
      await f.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
      await f.pool.query(
        "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
        [connection, actor]
      );
      return { actor, connection };
    }
    const create = (
      identity: Awaited<ReturnType<typeof owner>>,
      slug: string,
      key = randomUUID()
    ) =>
      asActor(
        client,
        identity.actor,
        async () =>
          (
            await client.query(
              'SELECT builder_create_draft($1,1,$2,$3,$4) result',
              [
                identity.connection,
                key,
                { ...input, requestedSlug: slug },
                config,
              ]
            )
          ).rows[0].result
      ) as Promise<{ storefrontId: string; version: string }>;
    const placeholder = await owner();
    const merchant = randomUUID();
    await f.pool.query(
      'INSERT INTO merchants(id,user_id,slug) VALUES($1,$2,$3)',
      [merchant, placeholder.actor, 'placeholder']
    );
    await f.pool.query(
      "INSERT INTO domains(merchant_id,domain,status,is_primary) VALUES($1,'existing.example.test','active',true)",
      [merchant]
    );
    const first = await create(placeholder, 'placeholder');
    assert.equal(first.storefrontId, merchant);
    const hosts = await f.pool.query(
      'SELECT domain,is_primary FROM domains WHERE merchant_id=$1 ORDER BY domain',
      [merchant]
    );
    assert.deepEqual(hosts.rows, [
      { domain: 'existing.example.test', is_primary: true },
      { domain: 'placeholder.usebaci.com', is_primary: false },
    ]);
    await assert.rejects(
      create(placeholder, 'another-slug'),
      /STORE_ALREADY_EXISTS/
    );
    const bound = await owner();
    const boundMerchant = randomUUID();
    await f.pool.query(
      'INSERT INTO merchants(id,user_id,slug) VALUES($1,$2,$3)',
      [boundMerchant, bound.actor, 'bound-placeholder']
    );
    await f.providerPool.query(
      'UPDATE builder_authorization.connections SET allowed_merchant_ids=ARRAY[$2::uuid] WHERE id=$1',
      [bound.connection, boundMerchant]
    );
    assert.equal(
      (await create(bound, 'bound-placeholder')).storefrontId,
      boundMerchant
    );
    for (const status of ['pending', 'inactive']) {
      const unfinished = await owner();
      const merchantId = randomUUID();
      const slug = `owned-${status}`;
      await f.pool.query(
        'INSERT INTO merchants(id,user_id,slug) VALUES($1,$2,$3)',
        [merchantId, unfinished.actor, slug]
      );
      await f.pool.query(
        "INSERT INTO domains(merchant_id,domain,status,is_primary) VALUES($1,'custom-'||$2||'.example.test','active',true),($1,'  '||upper($2)||'.USEBACI.COM  ',$3,false)",
        [merchantId, slug, status]
      );
      assert.equal((await create(unfinished, slug)).storefrontId, merchantId);
      const rows = await f.pool.query(
        'SELECT domain,status,is_primary,domain_type,tld FROM domains WHERE merchant_id=$1 ORDER BY is_primary DESC',
        [merchantId]
      );
      assert.equal(rows.rows[0].is_primary, true);
      assert.equal(rows.rows[0].domain, `custom-${slug}.example.test`);
      assert.deepEqual(rows.rows[1], {
        domain: `${slug}.usebaci.com`,
        status: 'active',
        is_primary: false,
        domain_type: 'subdomain',
        tld: '.usebaci.com',
      });
    }
    const immutable = await owner();
    await f.pool.query(
      'INSERT INTO merchants(id,user_id,slug) VALUES($1,$2,$3)',
      [randomUUID(), immutable.actor, 'keep-my-slug']
    );
    await assert.rejects(
      create(immutable, 'replace-my-slug'),
      /SLUG_IMMUTABLE/
    );
    for (const slug of ['auth', 'mcp']) {
      const identity = await owner();
      await assert.rejects(create(identity, slug), /INVALID_REQUEST/);
      assert.equal(
        (
          await f.pool.query(
            'SELECT count(*) FROM merchants WHERE user_id=$1',
            [identity.actor]
          )
        ).rows[0].count,
        '0'
      );
    }
    // A foreign inactive host still reserves its normalized name.
    await f.pool.query(
      "INSERT INTO domains(merchant_id,domain,status,is_primary) VALUES($1,'COLLISION.usebaci.com','pending',false)",
      [merchant]
    );
    const collision = await owner();
    await assert.rejects(create(collision, 'collision'), /SLUG_UNAVAILABLE/);
    assert.equal(
      (
        await f.pool.query('SELECT count(*) FROM merchants WHERE user_id=$1', [
          collision.actor,
        ])
      ).rows[0].count,
      '0'
    );
    assert.deepEqual(
      (
        await f.pool.query(
          'SELECT allowed_merchant_ids FROM builder_authorization.connections WHERE id=$1',
          [collision.connection]
        )
      ).rows[0].allowed_merchant_ids,
      []
    );
    const slugCollision = await owner();
    await assert.rejects(
      create(slugCollision, 'placeholder'),
      /SLUG_UNAVAILABLE/
    );
    // Audit failure is fatal to provisioning, never a successful best-effort write.
    await f.pool.query(
      "CREATE FUNCTION fail_builder_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_evidence_failure'; END $$;CREATE TRIGGER fail_builder_evidence BEFORE INSERT ON builder_authorization.mutation_evidence FOR EACH ROW EXECUTE FUNCTION fail_builder_evidence()"
    );
    const audit = await owner();
    await assert.rejects(
      create(audit, 'audit-rollback'),
      /fixture_evidence_failure/
    );
    assert.equal(
      (
        await f.pool.query('SELECT count(*) FROM merchants WHERE user_id=$1', [
          audit.actor,
        ])
      ).rows[0].count,
      '0'
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*) FROM domains WHERE domain='audit-rollback.usebaci.com'"
        )
      ).rows[0].count,
      '0'
    );
  } finally {
    client.release();
    await f.close();
  }
});
