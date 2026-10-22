import assert from 'node:assert/strict';

export async function runPrivateLifecycleEdgeChecks({
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
  productionSources = false,
}) {
  await check(
    'concurrent owner and staff saves admit exactly one CAS winner',
    async () => {
      const before = (await load()).body;
      const replies = await Promise.all([
        save(owner, before.updated_at, nextConfig),
        save(staff, before.updated_at, nextConfig),
      ]);
      assert(
        replies.every(
          (r) =>
            r.status === 200 || (productionSources && r.body.code === '40001')
        ),
        JSON.stringify(replies)
      );
      assert.equal(
        replies.filter((r) => r.status === 200 && !r.body.code).length,
        1
      );
      assert.equal(
        replies.filter(
          (r) =>
            r.body.code === 'stale_builder_draft' ||
            (productionSources && r.body.code === '40001')
        ).length,
        1
      );
    }
  );
  await check(
    'native AI apply preserves public content, checks CAS and marks exactly once under RLS',
    async () => {
      const before = (await load()).body;
      const created = await request('ai_jobs?select=id', owner, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          merchant_id: merchant,
          type: 'storefront_layout_generation',
          status: 'completed',
          input: productionSources
            ? { starterConfig: before.draft_config }
            : {},
        }),
      });
      assert.equal(created.status, 201, JSON.stringify(created));
      const jobId = created.body[0].id;
      const args = {
        p_job_id: jobId,
        p_merchant_id: merchant,
        p_page_slug: 'home',
        p_generated_config: nextConfig,
        p_generated_against_updated_at: '1900-01-01T00:00:00Z',
        p_force: false,
      };
      const apply = (user, body) =>
        request('rpc/apply_ai_storefront_draft', user, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      const denied = await apply(other, args);
      assert.equal(denied.status, 200);
      assert.equal(denied.body[0].code, 'forbidden');
      const stale = await apply(owner, args);
      assert.equal(stale.status, 200, JSON.stringify(stale));
      assert.equal(stale.body[0].code, 'ai_draft_stale');
      args.p_generated_against_updated_at = before.updated_at;
      const applied = await apply(staff, args);
      assert.equal(applied.status, 200, JSON.stringify(applied));
      assert.equal(applied.body[0].applied, true);
      const twice = await apply(owner, args);
      assert.equal(twice.body[0].code, 'job_already_applied');
      const after = (await load()).body;
      assert.deepEqual(after.published_config, before.published_config);
      assert.deepEqual(after.draft_config, nextConfig);
    }
  );
  if (sql)
    await check(
      'history failure rolls back public publication and leaves draft intact',
      async () => {
        const before = (await load()).body;
        await sql(
          `CREATE FUNCTION public.fixture_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture history unavailable'; END $$; CREATE TRIGGER fixture_reject_history BEFORE INSERT ON public.page_config_history FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_history();`
        );
        try {
          const failed = await rpc('publish', owner, {
            p_merchant_id: merchant,
            p_slug: 'home',
            p_expected: before.updated_at,
            p_scope: 'browser',
          });
          assert.equal(failed.status, 400, JSON.stringify(failed));
          const after = (await load()).body;
          assert.deepEqual(after, before);
        } finally {
          await sql(
            'DROP TRIGGER fixture_reject_history ON public.page_config_history; DROP FUNCTION public.fixture_reject_history();'
          );
        }
      }
    );
  await check(
    'private rename reconciles through owner RLS and invalidates previous CAS',
    async () => {
      const before = (await load()).body;
      const denied = await rpc('rename', other, {
        p_merchant_id: merchant,
        p_old: 'Fixture Shop',
        p_new: 'ATTACK',
      });
      assert([401, 403].includes(denied.status), JSON.stringify(denied));
      const renamed = await rpc('rename', owner, {
        p_merchant_id: merchant,
        p_old: 'Fixture Shop',
        p_new: '  Renamed  Shop  ',
      });
      assert.equal(renamed.status, 204, JSON.stringify(renamed));
      const after = (await load()).body;
      assert.equal(
        after.draft_config.content[0].props.storeName,
        'Renamed Shop'
      );
      const stale = await save(owner, before.updated_at, nextConfig);
      assert.equal(stale.body.code, 'stale_builder_draft');
    }
  );
  await check(
    'secondary pending pages remain private during homepage publication',
    async () => {
      const created = await save(
        owner,
        null,
        { content: 'PRIVATE-SECONDARY' },
        'about'
      );
      assert.equal(created.status, 200, JSON.stringify(created));
      assert(!created.body.code);
      const before = (await load()).body;
      const publish = await rpc('publish', owner, {
        p_merchant_id: merchant,
        p_slug: 'home',
        p_expected: before.updated_at,
        p_scope: 'homepage_layout',
      });
      assert.equal(publish.status, 200, JSON.stringify(publish));
      assert(!publish.body.code);
      const secondary = await load(owner, 'about');
      assert.equal(secondary.body.draft_config.content, 'PRIVATE-SECONDARY');
      assert.equal(secondary.body.is_published, false);
      const denied = await request(
        `page_configs?select=published_config&merchant_id=eq.${merchant}&page_slug=eq.about`
      );
      assert.equal(denied.status, 200);
      assert.deepEqual(denied.body, []);
    }
  );
  await check(
    'unpublish and delete hide public rows while preserving private ownership boundaries',
    async () => {
      const filter = `page_configs?merchant_id=eq.${merchant}&page_slug=eq.home`;
      const unpublished = await request(filter, owner, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ is_published: false }),
      });
      assert.equal(unpublished.status, 200, JSON.stringify(unpublished));
      for (const user of [undefined, other]) {
        const r = await request(`${filter}&select=published_config`, user);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, []);
      }
      assert((await load()).body.draft_config);
      const deleted = await request(filter, owner, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });
      assert.equal(deleted.status, 200, JSON.stringify(deleted));
      assert.equal((await load()).body, null);
    }
  );
  await check(
    'fresh onboarding atomically creates private draft and compatible public curated homepage',
    async () => {
      const r = await rpc('onboard', owner, {
        p_merchant_id: merchant,
        p_config: nextConfig,
      });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert(!r.body.code);
      const after = (await load()).body;
      assert.deepEqual(after.draft_config, nextConfig);
      assert.deepEqual(after.published_config, nextConfig);
      const publicPage = await request(
        `page_configs?select=published_config&merchant_id=eq.${merchant}&page_slug=eq.home&is_published=eq.true`
      );
      assert.equal(publicPage.status, 200);
      assert.deepEqual(publicPage.body[0].published_config, nextConfig);
    }
  );
}
