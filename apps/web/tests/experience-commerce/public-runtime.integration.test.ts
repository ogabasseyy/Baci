import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { createPublicExperienceRuntime } from '../../src/lib/experience/public-runtime';
import { createCommerceEngineFixture } from './cart-engine-fixture';
import { prepareCommerceCatalog } from './catalog-fixture';
import { startCommerceDataApi } from './data-api';

it('normal-role public runtime follows owner/RLS native price updates, current canonical routes and empty collections without orders', async () => {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  try {
    const ids = await prepareCommerceCatalog(f);
    const a = randomUUID();
    const j = randomUUID();
    const b = randomUUID();
    const approval = randomUUID();
    const nonce = randomUUID();
    const digest = 'a'.repeat(64);
    const manifest = {
      routes: [
        { path: '/', view: 'home' },
        { path: '/products/[handle]', view: 'product' },
        { path: '/collections/[handle]', view: 'collection' },
        { path: '/pages/story', view: 'editorial' },
      ],
      capabilities: ['catalog.read', 'cart.mutate'],
      assets: [],
    };
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [a, ids.merchant, digest, manifest]
    );
    await f.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [j, ids.merchant, a, randomUUID(), digest, nonce]
    );
    await f.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest) VALUES($1,$2,$3,$4,'[]')",
      [b, ids.merchant, j, digest]
    );
    await f.pool.query(
      "INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,'synthetic-read-fixture','http://127.0.0.1:43174')",
      [ids.merchant, j, nonce, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
      [approval, ids.merchant, b, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_published_heads VALUES($1,$2,$3,1)',
      [ids.merchant, b, approval]
    );
    await f.pool.query(
      "INSERT INTO categories(merchant_id,name,slug) VALUES($1,'Empty synthetic category','empty')",
      [ids.merchant]
    );
    api = await startCommerceDataApi(f);
    const client = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const runtime = createPublicExperienceRuntime({
      client,
      runtimeBase: 'http://127.0.0.1:43175',
      canonicalBase: (slug) => `http://127.0.0.1:43174/${slug}`,
    });
    const merchant = { id: ids.merchant, slug: 'qa1' };
    const first = await runtime.resolveBoundary(
      merchant,
      '/phones/synthetic-device'
    );
    expect(first?.bootstrap.catalog.products[0].price).toBe(250);
    expect(first?.bootstrap.route).toMatchObject({
      routeId: 'product',
      canonicalPath: '/phones/synthetic-device',
    });
    expect(
      (await runtime.resolveBoundary(merchant, '/collections/empty'))?.bootstrap
        .catalog.products
    ).toEqual([]);
    const owner = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${api.ownerToken(ids.owner, ids.session)}`,
        },
      },
    });
    const changed = await owner
      .from('products')
      .update({ price: 275 })
      .eq('id', '33333333-3333-4333-8333-333333333333');
    expect(changed.error).toBeNull();
    const after = await runtime.resolveBoundary(
      merchant,
      '/phones/synthetic-device'
    );
    expect(after?.bootstrap.catalog.products[0].price).toBe(275);
    expect(after?.bootstrap.catalog.revision).not.toBe(
      first?.bootstrap.catalog.revision
    );
    expect(
      await runtime.resolveBoundary(merchant, '/phones/missing')
    ).toBeNull();
    expect(
      await runtime.resolveBoundary({ id: randomUUID(), slug: 'qa1' }, '/')
    ).toBeNull();
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await api?.close();
    await f.close();
  }
});
