import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/** Actual current-schema constraints, normal JWT/Data API, no provider/session secrets. */
export async function runFullProvisioningChecks({ request, check, sql }) {
  const actor = randomUUID();
  const connection = randomUUID();
  const retry = randomUUID();
  sql(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES('${actor}','authenticated','authenticated','task4-${actor}@example.test',now(),now());COMMIT;
 INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES('${connection}','${actor}','fixture-${connection}',ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour');`);
  const initial = {
    root: {
      props: { rendererVersion: 'baci-home-six-v1', title: 'New Draft' },
    },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'hero',
          title: 'New Draft',
          subtitle: 'Draft only',
          ctaText: 'Browse',
          ctaLink: '/products',
        },
      },
    ],
  };
  const args = {
    p_connection: connection,
    p_version: 1,
    p_retry_key: retry,
    p_input: {
      businessName: 'New Draft',
      businessType: 'electronics',
      country: 'NG',
      requestedSlug: `draft-${actor.slice(0, 8)}`,
    },
    p_config: initial,
  };
  const call = (name, body) =>
    request(`rpc/${name}`, actor, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  let created;
  await check(
    'current schema normal-user create atomically binds consent, domain, private homepage and effect record',
    async () => {
      const r = await call('builder_create_draft', args);
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.body.status, 'draft');
      created = r.body;
      const stores = await request(
        `merchants?select=id,is_published&user_id=eq.${actor}`,
        actor
      );
      assert.equal(stores.status, 200, JSON.stringify(stores));
      assert.deepEqual(stores.body, [
        { id: created.storefrontId, is_published: false },
      ]);
      const domain = await request(
        `domains?select=domain,status,is_primary&merchant_id=eq.${created.storefrontId}`,
        actor
      );
      assert.equal(domain.status, 200, JSON.stringify(domain));
      assert.deepEqual(domain.body, [
        {
          domain: `${args.p_input.requestedSlug}.usebaci.com`,
          status: 'active',
          is_primary: true,
        },
      ]);
      const publicPages = await request(
        `page_configs?select=published_config&merchant_id=eq.${created.storefrontId}&is_published=eq.true`
      );
      assert.deepEqual(publicPages.body, []);
      const replay = await call('builder_create_draft', args);
      assert.equal(replay.status, 200, JSON.stringify(replay));
      assert.deepEqual(replay.body, created);
    }
  );
  await check(
    'same canonical connection reads and commits a private draft under the full schema',
    async () => {
      const read = await call('builder_read_storefronts', {
        p_connection: connection,
        p_version: 1,
        p_merchant: created.storefrontId,
      });
      assert.equal(read.status, 200, JSON.stringify(read));
      assert.equal(read.body[0].version, created.version);
      const commit = await call('builder_commit_draft', {
        p_connection: connection,
        p_version: 1,
        p_merchant: created.storefrontId,
        p_expected: created.version.slice(6),
        p_retry_key: randomUUID(),
        p_config: {
          ...initial,
          content: [
            {
              type: 'Hero',
              props: {
                ...initial.content[0].props,
                subtitle: 'Edited privately',
              },
            },
          ],
        },
      });
      assert.equal(commit.status, 200, JSON.stringify(commit));
      assert.equal(commit.body.status, 'draft');
      assert.notEqual(commit.body.version, created.version);
      const page = await request(
        `page_configs?select=published_config,is_published&merchant_id=eq.${created.storefrontId}`,
        actor
      );
      assert.deepEqual(page.body, [
        { published_config: null, is_published: false },
      ]);
    }
  );
  await check(
    'legacy public identity RPC reconciles private names without privileged private writes',
    async () => {
      const merchant = await request(
        `merchants?select=updated_at&user_id=eq.${actor}`,
        actor
      );
      const rename = await call('update_merchant_identity_settings', {
        p_merchant_id: created.storefrontId,
        p_settings: { business_name: 'Renamed Draft' },
        p_expected_updated_at: merchant.body[0].updated_at,
      });
      assert.equal(rename.status, 200, JSON.stringify(rename));
      const draft = await request(
        `builder_page_drafts?select=draft_config&merchant_id=eq.${created.storefrontId}`,
        actor
      );
      assert.equal(draft.status, 200, JSON.stringify(draft));
      assert.equal(
        draft.body[0].draft_config.root.props.title,
        'Renamed Draft'
      );
    }
  );
  await check(
    'private effect ledger and original guarded identity implementation are not exposed by Data API',
    async () => {
      const evidence = await request('mutation_evidence?select=id', actor);
      assert.equal(evidence.status, 404, JSON.stringify(evidence));
      const direct = await call('guarded_merchant_identity_settings', {
        p_merchant_id: created.storefrontId,
        p_settings: { business_name: 'Bypass' },
        p_expected_updated_at: '2026-01-01T00:00:00Z',
      });
      assert.equal(direct.status, 404, JSON.stringify(direct));
    }
  );
  await check(
    'full schema revocation fences old-context replay and reads',
    async () => {
      assert.equal(
        (
          await call('disconnect_builder_connection', {
            p_connection_id: connection,
          })
        ).body,
        true
      );
      for (const [name, body] of [
        ['builder_create_draft', args],
        [
          'builder_read_storefronts',
          {
            p_connection: connection,
            p_version: 1,
            p_merchant: created.storefrontId,
          },
        ],
      ]) {
        const denied = await call(name, body);
        assert.equal(denied.status, 403, JSON.stringify(denied));
        assert.equal(denied.body.message, 'CONNECTION_REVOKED');
      }
    }
  );
}
