import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { createCommerceEngineFixture } from './cart-engine-fixture';
import { prepareQuoteAttestationFixture } from './quote-fixture.ts';

const migration = (name: string) =>
  readFileSync(
    new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
    'utf8'
  );
export async function prepareCommerceCatalog(
  f: Awaited<ReturnType<typeof createCommerceEngineFixture>>
) {
  await f.pool.query(
    readFileSync(new URL('./commerce-catalog.sql', import.meta.url), 'utf8')
  );
  await prepareQuoteAttestationFixture(f);
  // The existing main counter accepts a default branch argument. This fixture's
  // real inventory table is local and no order allocation can run.
  await f.pool.query(
    `CREATE OR REPLACE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid DEFAULT NULL) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;`
  );
  await f.pool.query(
    'CREATE ROLE baci_experience_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;GRANT USAGE ON SCHEMA public TO baci_experience_verifier;'
  );
  for (const name of [
    '20261008270000_storefront_variant_rpc_serialized_policy.sql',
    '20260713120001_merchant_shipping_zones_and_rates.sql',
    '20260903131000_expose_storefront_shipping_provider_toggle.sql',
    '20260823010000_public_shipping_sender_projection.sql',
    '20261015156000_commerce_cart_grant_operations.sql',
    '20261015158000_commerce_cart_grant_expiry.sql',
    '20261024072905_experience_private_foundation.sql',
    '20261024120000_experience_catalog_generations.sql',
    '20261024124000_experience_public_read_projection.sql',
    '20261103203000_experience_public_manifest_order.sql',
    '20261024130000_experience_verified_snapshots.sql',
  ])
    await f.pool.query(migration(name));
  await f.pool.query(
    'ALTER TABLE experience_evidence ADD COLUMN IF NOT EXISTS host_origin text'
  );
  const owner = randomUUID();
  const session = randomUUID();
  const merchant = '11111111-1111-4111-8111-111111111111';
  await f.pool.query('INSERT INTO auth.users VALUES($1);', [owner]);
  await f.pool.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)', [
    session,
    owner,
  ]);
  await f.pool.query(
    "UPDATE merchants SET business_name='Synthetic Baci Store',slug='qa1',user_id=$1,is_published=true,payout_currency='NGN',country='NG',premium_features='[\"shared_cart\"]' WHERE id=$2",
    [owner, merchant]
  );
  const category = (
    await f.pool.query(
      "INSERT INTO categories(merchant_id,name,slug) VALUES($1,'Phones','phones') RETURNING id",
      [merchant]
    )
  ).rows[0].id;
  await f.pool.query(
    "UPDATE products SET name='Synthetic QA Device',slug=CASE id WHEN '33333333-3333-4333-8333-333333333333' THEN 'synthetic-device' ELSE 'synthetic-'||left(id::text,8) END,category_id=$1,has_variants=false,manage_stock=false WHERE merchant_id=$2",
    [category, merchant]
  );
  await f.pool.query(
    'INSERT INTO product_categories SELECT id,$1 FROM products WHERE merchant_id=$2',
    [category, merchant]
  );
  await f.pool.query(
    'INSERT INTO merchant_feature_settings(merchant_id) VALUES($1)',
    [merchant]
  );
  const c = await f.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: owner,
        role: 'authenticated',
        session_id: session,
      }),
    ]);
    await c.query(
      "UPDATE merchants SET business_address='1 Synthetic Road, Ikeja, Lagos',phone='+2348000000000',email='synthetic.owner@example.test' WHERE id=$1",
      [merchant]
    );
    const zone = (
      await c.query(
        "INSERT INTO merchant_shipping_zones(merchant_id,name) VALUES($1,'Synthetic Lagos') RETURNING id",
        [merchant]
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO merchant_shipping_zone_locations(zone_id,country_code,subdivision_code) VALUES($1,'NG','NG-LA')",
      [zone]
    );
    await c.query(
      "INSERT INTO merchant_shipping_rates(merchant_id,zone_id,name,kind,currency,base_amount,condition_type) VALUES($1,$2,'Synthetic local delivery','ship','NGN',1500,'always')",
      [merchant, zone]
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
  return { owner, session, merchant, category };
}
