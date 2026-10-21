import assert from 'node:assert/strict';
import { runPrivateLifecycleEdgeChecks } from './private-lifecycle-edge-checks.mjs';

/** Shared raw Data API acceptance contract; parent full replay supplies REAL
 * owner/staff membership fixtures. Reduced probe labels its helpers synthetic. */
export async function runPrivateLifecycleChecks({
  request,
  check,
  owner,
  staff,
  other,
  merchant,
  sql,
}) {
  const rpc = (name, user, args) =>
    request(`rpc/builder_private_${name}`, user, {
      method: 'POST',
      body: JSON.stringify(args),
    });
  const load = (user = owner, slug = 'home') =>
    rpc('load', user, { p_merchant_id: merchant, p_slug: slug });
  const save = (user, expected, config, slug = 'home') =>
    rpc('save', user, {
      p_merchant_id: merchant,
      p_slug: slug,
      p_name: slug === 'home' ? 'Home' : slug,
      p_config: config,
      p_seo: { title: 'PRIVATE-PENDING-SEO' },
      p_store: { value: 'PRIVATE-PENDING-STORE' },
      p_setup: { value: 'PRIVATE-PENDING-SETUP' },
      p_expected: expected,
    });
  let snapshot;
  await check(
    'adapted browser load composes private draft and public published DTO',
    async () => {
      const r = await load();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.draft_config.content, 'PRIVATE-DRAFT');
      assert.equal(r.body.published_config.content, 'PUBLIC');
      snapshot = r.body;
    }
  );
  await check(
    'cross-tenant lifecycle RPC read and write denied under RLS',
    async () => {
      const read = await load(other);
      assert.equal(read.status, 200);
      assert.equal(read.body, null);
      const write = await save(other, snapshot.updated_at, {
        content: 'ATTACK',
      });
      assert([401, 403].includes(write.status), JSON.stringify(write));
    }
  );
  const nextConfig = {
    content: [
      { type: 'Header', props: { id: 'header', storeName: 'Fixture Shop' } },
    ],
    root: {},
    zones: {},
  };
  await check(
    'owner save preserves current public config and rejects stale CAS',
    async () => {
      const saved = await save(owner, snapshot.updated_at, nextConfig);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert(!saved.body.code);
      const stale = await save(owner, snapshot.updated_at, {
        content: 'LOST-UPDATE',
      });
      assert.equal(stale.body.code, 'stale_builder_draft');
      const after = await load();
      assert.deepEqual(after.body.draft_config, nextConfig);
      assert.deepEqual(after.body.published_config, snapshot.published_config);
      snapshot = after.body;
    }
  );
  await check(
    'permitted builder staff can load and save private draft with CAS',
    async () => {
      const before = await load(staff);
      assert.equal(before.status, 200);
      assert(before.body);
      const saved = await save(staff, before.body.updated_at, nextConfig);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert(!saved.body.code);
      snapshot = (await load()).body;
    }
  );
  await check(
    'native AI enqueue captures server authorized snapshot, ignores supplied starter',
    async () => {
      const queued = await rpc('enqueue', owner, {
        p_merchant_id: merchant,
        p_slug: 'home',
        p_input: {
          businessName: 'Fixture Shop',
          businessType: 'general',
          brandColors: null,
          starterConfig: { secret: 'CLIENT-ATTACK' },
          createdPageConfigUpdatedAt: '1900-01-01',
        },
      });
      assert.equal(queued.status, 200, JSON.stringify(queued.body));
      const job = await request(
        `ai_jobs?select=input&id=eq.${queued.body.id}`,
        owner
      );
      assert.equal(job.status, 200);
      assert.deepEqual(job.body[0].input.starterConfig, nextConfig);
      assert.equal(
        job.body[0].input.createdPageConfigUpdatedAt,
        snapshot.updated_at
      );
      const denied = await request(
        `ai_jobs?select=input&id=eq.${queued.body.id}`,
        other
      );
      assert.equal(denied.status, 200);
      assert.deepEqual(denied.body, []);
    }
  );
  await check(
    'homepage layout publication preserves pending and current published side fields',
    async () => {
      const publicBefore = await request(
        `page_configs?select=published_seo,published_store_settings,published_setup_settings&merchant_id=eq.${merchant}&page_slug=eq.home`,
        owner
      );
      const published = await rpc('publish', owner, {
        p_merchant_id: merchant,
        p_slug: 'home',
        p_expected: snapshot.updated_at,
        p_scope: 'homepage_layout',
      });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert(!published.body.code);
      const publicAfter = await request(
        `page_configs?select=published_config,published_seo,published_store_settings,published_setup_settings&merchant_id=eq.${merchant}&page_slug=eq.home`
      );
      const { published_config, ...side } = publicAfter.body[0];
      assert.deepEqual(published_config, nextConfig);
      assert.deepEqual(side, publicBefore.body[0]);
      const after = await load();
      assert.equal(after.body.draft_seo.title, 'PRIVATE-PENDING-SEO');
      snapshot = after.body;
    }
  );
  await check(
    'ordinary browser publication retains its authorized side-field promotion',
    async () => {
      const r = await rpc('publish', owner, {
        p_merchant_id: merchant,
        p_slug: 'home',
        p_expected: snapshot.updated_at,
        p_scope: 'browser',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert(!r.body.code);
      const page = await request(
        `page_configs?select=published_seo&merchant_id=eq.${merchant}&page_slug=eq.home`
      );
      assert.equal(page.body[0].published_seo.title, 'PRIVATE-PENDING-SEO');
    }
  );
  await check(
    'onboarding never overwrites an existing curated homepage',
    async () => {
      const r = await rpc('onboard', owner, {
        p_merchant_id: merchant,
        p_config: { content: 'OVERWRITE' },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.code, 'already_exists');
      assert.deepEqual((await load()).body.draft_config, nextConfig);
    }
  );
  await runPrivateLifecycleEdgeChecks({
    request,
    check,
    owner,
    staff,
    other,
    merchant,
    sql,
    load,
    save,
    rpc,
    nextConfig,
  });
  return { nextConfig };
}
