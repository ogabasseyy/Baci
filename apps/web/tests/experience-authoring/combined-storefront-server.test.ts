import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createPublicOutputReader } from '@/lib/experience/public-output-reader';
import { startPublishedGateway } from '../../tools/experience-runner/published-gateway';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import {
  installCombinedCartFixture,
  installCombinedCatalogFixture,
  installCombinedPublicCatalogFixture,
  installCombinedShippingFixture,
  setSyntheticShippingOrigin,
} from './combined-cart-fixture.test-support';
import { startCombinedStorefrontServer } from './combined-storefront-server.test-support';
import { experienceDataFixture } from './data-fixture.test-support';
import { checkPublicStorefrontBrowser } from './public-storefront-browser.test-support';
import { seedSyntheticPublicRead } from './synthetic-public-read.test-support';

vi.mock('server-only', () => ({}));

it('starts an owned local storefront process against the disposable Data API', async () => {
  const f = await experienceDataFixture();
  const directory = mkdtempSync(join(tmpdir(), 'baci-local-browser-'));
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  let server:
    | Awaited<ReturnType<typeof startCombinedStorefrontServer>>
    | undefined;
  let gateway: Awaited<ReturnType<typeof startPublishedGateway>> | undefined;
  try {
    await installCombinedCartFixture(f);
    const grantFunction = await f.db.pool.query(
      "SELECT pg_get_functiondef(to_regprocedure('public.commerce_cart_grant_operations()')) AS definition"
    );
    expect(grantFunction.rows[0].definition).toContain('grantExpiresAt');
    await installCombinedCatalogFixture(f);
    await installCombinedShippingFixture(f);
    await installCombinedPublicCatalogFixture(f);
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const attempt = randomUUID();
    const digest = 'a'.repeat(64);
    await f.db.pool.query(
      "UPDATE merchants SET slug='synthetic',is_published=false,country='US',payout_currency='USD',premium_features='[\"shared_cart\"]',business_name='Synthetic storefront' WHERE id=$1",
      [f.merchantId]
    );
    await setSyntheticShippingOrigin(f.owner, f.merchantId);
    const zone = await f.owner.supabase
      .from('merchant_shipping_zones')
      .insert({ merchant_id: f.merchantId, name: 'Synthetic US' })
      .select('id')
      .single();
    expect(zone.error).toBeNull();
    if (!zone.data) throw Error('SYNTHETIC_ZONE_MISSING');
    expect(
      (
        await f.owner.supabase
          .from('merchant_shipping_zone_locations')
          .insert({ zone_id: zone.data.id, country_code: 'US' })
      ).error
    ).toBeNull();
    expect(
      (
        await f.owner.supabase.from('merchant_shipping_rates').insert({
          merchant_id: f.merchantId,
          zone_id: zone.data.id,
          name: 'Synthetic delivery',
          kind: 'ship',
          currency: 'USD',
          base_amount: 1500,
          condition_type: 'always',
        })
      ).error
    ).toBeNull();
    const product = await f.owner.supabase.from('products').insert({
      merchant_id: f.merchantId,
      name: 'Synthetic device',
      slug: 'synthetic-device',
      price: 250,
      status: 'active',
      images: [],
    });
    expect(product.error).toBeNull();
    await f.db.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        artifact,
        f.merchantId,
        digest,
        {
          assets: [],
          routes: [{ path: '/', view: 'home' }],
          capabilities: ['catalog.read'],
        },
      ]
    );
    await f.db.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), digest, attempt]
    );
    await f.db.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','https://synthetic.synthetic.test')",
      [build, f.merchantId, job, digest]
    );
    await f.db.pool.query(
      "INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,'synthetic','https://synthetic.synthetic.test')",
      [f.merchantId, job, attempt, digest]
    );
    for (const [path, mime, text] of [
      [
        'app.js',
        'text/javascript',
        'document.body.dataset.fixture="synthetic"',
      ],
      ['app.css', 'text/css', 'body{color:black}'],
    ]) {
      const bytes = Buffer.from(text);
      await f.db.pool.query(
        'INSERT INTO experience_build_files(merchant_id,build_id,path,digest,bytes,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [f.merchantId, build, path, digestBytes(bytes), bytes, mime]
      );
    }
    await seedSyntheticPublicRead(f, f.merchantId, build);
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
    api = await startCommerceDataApi({
      pool: f.db.pool,
      connection: { host: f.db.localDatabase.socketDirectory },
    });
    const snapshot = await fetch(
      `${api.url}/rest/v1/rpc/resolve_storefront_public_snapshot_v2`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${api.anonKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_identifier: 'synthetic' }),
      }
    );
    expect(snapshot.status).toBe(200);
    expect((await snapshot.json())[0]?.merchant_data?.country).toBe('US');
    const productRead = await fetch(
      `${api.url}/rest/v1/products?select=id,name,description,status,price,manage_stock,stock,stock_quantity,has_variants,has_condition_offers,brand,gtin,mpn,merchant_id,images,imageHint:image_hint`,
      { headers: { authorization: `Bearer ${api.anonKey}` } }
    );
    expect(productRead.status, await productRead.text()).toBe(200);
    server = await startCombinedStorefrontServer(api, directory);
    const response = await fetch(`${server.origin}/api/csrf`, {
      signal: AbortSignal.timeout(60000),
    });
    expect(response.status, server.output()).toBe(200);
    expect((await response.json()).token).toBeTypeOf('string');
    const storefront = await fetch(`${server.origin}/synthetic`, {
      headers: {
        host: 'synthetic.synthetic.test',
        'x-forwarded-host': 'synthetic.synthetic.test',
        'x-forwarded-proto': 'https',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
    expect(storefront.status, server.output()).toBe(200);
    expect((await storefront.text()).includes('Synthetic storefront')).toBe(
      true
    );
    const quote = await fetch(`${server.origin}/api/shipping/quotes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: server.origin,
        referer: `${server.origin}/synthetic/checkout`,
        'x-baci-client': 'web-storefront',
      },
      body: JSON.stringify({
        merchantId: f.merchantId,
        shipmentType: 'domestic',
        supports_merchant_rates: true,
        receiver: {
          name: 'Synthetic Buyer',
          address: '123 Test Street',
          city: 'Los Angeles',
          state: 'California',
          country: 'United States',
          countryCode: 'US',
        },
        items: [
          {
            name: 'Synthetic device',
            hsCode: '851712',
            weight: 1,
            quantity: 1,
            value: 250,
          },
        ],
      }),
    });
    const quoteText = await quote.text();
    expect(quote.status, `${quoteText}; ${server.output().slice(-5000)}`).toBe(
      200
    );
    expect(quoteText).toContain('Synthetic delivery');
    gateway = await startPublishedGateway(
      createPublicOutputReader(f.anonymous),
      'https://synthetic.synthetic.test'
    );
    try {
      await checkPublicStorefrontBrowser({
        storefrontOrigin: server.origin,
        gatewayOrigin: gateway.origin,
        dataOrigin: api.url,
        stopAfterFrame: true,
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : 'BROWSER_FAILED'}; server=${server.output().slice(-5000)}`
      );
    }
    expect(
      (await f.db.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await server?.close();
    await gateway?.close();
    await api?.close();
    rmSync(directory, { recursive: true, force: true });
    await f.close();
  }
}, 180000);
