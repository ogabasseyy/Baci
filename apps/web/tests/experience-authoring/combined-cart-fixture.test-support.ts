import { readFileSync } from 'node:fs';
import { cartSetupSql } from '../experience-commerce/cart-engine-fixture';
import type { experienceDataFixture } from './data-fixture.test-support';

/** Install the cart SQL in the already-disposable authoring database. */
export async function installCombinedCartFixture(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  let sql = cartSetupSql();
  function replaceOnce(pattern: RegExp, replacement: string) {
    if (!pattern.test(sql)) throw Error('CART_FIXTURE_SOURCE_CHANGED');
    sql = sql.replace(pattern, replacement);
  }
  replaceOnce(
    /CREATE SCHEMA auth;\nCREATE FUNCTION auth\.jwt\(\)[\s\S]*?\$\$;/,
    ''
  );
  replaceOnce(/CREATE TABLE public\.merchants \([\s\S]*?\n\);/, '');
  replaceOnce(
    /CREATE TABLE public\.products \([\s\S]*?\n\);/,
    `ALTER TABLE public.products ADD COLUMN stock_quantity integer NOT NULL DEFAULT 0,
     ADD COLUMN stock integer NOT NULL DEFAULT 0, ADD COLUMN manage_stock boolean NOT NULL DEFAULT true,
     ADD COLUMN has_variants boolean NOT NULL DEFAULT false, ADD COLUMN brand text;`
  );
  replaceOnce(
    /INSERT INTO public\.merchants \(id, slug, premium_features\) VALUES[\s\S]*?(?=CREATE ROLE authenticator;)/,
    ''
  );
  replaceOnce(
    /CREATE FUNCTION auth\.uid\(\) RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT nullif\(auth\.jwt\(\)->>'sub',''\)::uuid \$\$; /,
    ''
  );
  replaceOnce(
    /ALTER TABLE public\.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;/,
    'ALTER TABLE public.merchants ADD COLUMN is_platform_admin boolean DEFAULT false;'
  );
  replaceOnce(
    /CREATE TABLE IF NOT EXISTS public\.merchant_feature_settings\(merchant_id uuid PRIMARY KEY,agentic_checkout_enabled boolean,pay_on_delivery_enabled boolean,custom_settings jsonb\);/,
    'ALTER TABLE public.merchant_feature_settings ADD COLUMN agentic_checkout_enabled boolean, ADD COLUMN custom_settings jsonb;'
  );
  await fixture.db.pool.query(
    'ALTER TABLE public.domains ADD COLUMN updated_at timestamptz, ADD COLUMN created_at timestamptz'
  );
  await fixture.db.pool.query(sql);
  for (const name of [
    '20261015156000_commerce_cart_grant_operations.sql',
    '20261015158000_commerce_cart_grant_expiry.sql',
  ]) {
    await fixture.db.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8'
      )
    );
  }
  await fixture.db.pool.query(
    'GRANT UPDATE(manage_stock) ON products TO authenticated'
  );
  // Even a mistakenly invoked order routine cannot persist an order here.
  await fixture.db.pool.query(`
    CREATE FUNCTION public.fixture_no_orders() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_FIXTURE_ORDERS_DISABLED'; END $$;
    CREATE TRIGGER fixture_no_orders BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.fixture_no_orders();
  `);
  await fixture.db.pool.query(
    readFileSync(
      new URL(
        '../../../../supabase/migrations/20261105210000_commerce_cart_checkout_database_clock.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
}

/** Add the production catalog adapter's schema dependencies to the disposable fixture. */
export async function installCombinedCatalogFixture(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  await fixture.db.pool.query(`
    CREATE TABLE public.categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),name text,slug text,is_active boolean DEFAULT true,parent_id uuid);
    CREATE TABLE public.product_categories(product_id uuid REFERENCES products(id),category_id uuid REFERENCES categories(id));
    CREATE TABLE public.branches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),is_active boolean DEFAULT true,is_default boolean DEFAULT true);
    ALTER TABLE products ADD COLUMN category text, ADD COLUMN category_id uuid REFERENCES categories(id), ADD COLUMN canonical_url text, ADD COLUMN is_parent boolean DEFAULT true, ADD COLUMN parent_product_id uuid;
    ALTER TABLE product_variants ADD COLUMN condition text, ADD COLUMN sku text, ADD COLUMN attributes jsonb DEFAULT '{}', ADD COLUMN images jsonb DEFAULT '[]', ADD COLUMN primary_image text, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_category_owner ON categories FOR SELECT TO authenticated USING(public.has_merchant_access(merchant_id));
    ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_product_category_owner ON product_categories FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM products p WHERE p.id=product_id));
    ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_variant_owner ON product_variants FOR SELECT TO authenticated USING(public.has_merchant_access(merchant_id));
    GRANT SELECT(id,merchant_id,name,slug,is_active,parent_id) ON categories TO authenticated;
    GRANT SELECT(product_id,category_id) ON product_categories TO authenticated;
    GRANT SELECT(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor) ON product_variants TO authenticated;
    GRANT SELECT(category,category_id,canonical_url,is_parent,parent_product_id,manage_stock,stock,stock_quantity,has_variants,inventory_tracking_policy) ON products TO authenticated;
    CREATE OR REPLACE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid DEFAULT NULL) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;
  `);
  for (const name of [
    '20261008270000_storefront_variant_rpc_serialized_policy.sql',
    '20261024120000_experience_catalog_generations.sql',
  ])
    await fixture.db.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8'
      )
    );
  await fixture.db.pool.query("NOTIFY pgrst, 'reload schema'");
}

/** Public catalog policies in the compact, disposable storefront fixture. */
export async function installCombinedPublicCatalogFixture(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  await fixture.db.pool.query(`
    ALTER TABLE merchants ADD COLUMN plan_tier text DEFAULT 'business', ADD COLUMN plan_expires_at timestamptz, ADD COLUMN business_address text, ADD COLUMN state_code text DEFAULT 'LA';
    ALTER TABLE products ADD COLUMN description text, ADD COLUMN image_hint text, ADD COLUMN has_condition_offers boolean DEFAULT false, ADD COLUMN gtin text DEFAULT '', ADD COLUMN mpn text DEFAULT '';
    CREATE TABLE public.merchant_slug_aliases(old_slug text,merchant_id uuid REFERENCES merchants(id));
    CREATE POLICY fixture_published_merchant ON merchants FOR SELECT TO anon,authenticated USING(is_published IS TRUE OR user_id=auth.uid());
    GRANT SELECT(id,slug,business_name,business_address,state_code,phone,email,template_id,is_published,payout_currency,country,premium_features,plan_tier,plan_expires_at) ON merchants TO anon,authenticated;
    GRANT UPDATE(business_address,state_code,phone) ON merchants TO authenticated;
    CREATE POLICY fixture_public_products ON products FOR SELECT TO anon,authenticated USING(status='active' AND EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.is_published));
    GRANT SELECT(id,merchant_id,slug,name,description,price,status,images,category,category_id,canonical_url,is_parent,parent_product_id,manage_stock,stock,stock_quantity,has_variants,inventory_tracking_policy,image_hint,has_condition_offers,brand,gtin,mpn) ON products TO anon,authenticated;
    CREATE POLICY fixture_public_categories ON categories FOR SELECT TO anon,authenticated USING(is_active AND EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.is_published));
    GRANT SELECT(id,merchant_id,name,slug,is_active,parent_id) ON categories TO anon,authenticated;
    CREATE POLICY fixture_public_membership ON product_categories FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM products p WHERE p.id=product_id));
    GRANT SELECT(product_id,category_id) ON product_categories TO anon,authenticated;
    CREATE POLICY fixture_public_variants ON product_variants FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM products p WHERE p.id=product_id AND p.merchant_id=product_variants.merchant_id));
    GRANT SELECT(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor) ON product_variants TO anon,authenticated;
    GRANT SELECT ON merchant_slug_aliases,domains TO anon,authenticated;
  `);
  const source = readFileSync(
    new URL('../experience-commerce/commerce-catalog.sql', import.meta.url),
    'utf8'
  );
  const start = source.indexOf(
    'CREATE FUNCTION public.resolve_storefront_auth_merchant'
  );
  const end = source.indexOf('-- An accidental submission', start);
  if (start < 0 || end < 0) throw Error('PUBLIC_PROJECTION_FIXTURE_CHANGED');
  await fixture.db.pool.query(source.slice(start, end));
  await fixture.db.pool.query(
    readFileSync(
      new URL(
        '../../../../supabase/migrations/20260823010000_public_shipping_sender_projection.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  await fixture.db.pool.query("NOTIFY pgrst, 'reload schema'");
}

export async function setSyntheticShippingOrigin(
  owner: Awaited<ReturnType<typeof experienceDataFixture>>['owner'],
  merchantId: string
) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await owner.supabase
      .from('merchants')
      .update({
        business_address: '100 Synthetic Road, Los Angeles, California',
        state_code: 'CA',
        phone: '+15550102000',
      })
      .eq('id', merchantId)
      .select('id')
      .single();
    if (!response.error) return;
    if (response.error.code !== 'PGRST204')
      throw Error(`SYNTHETIC_ORIGIN_${response.error.code}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('SYNTHETIC_SCHEMA_RELOAD_TIMEOUT');
}

export async function installCombinedShippingFixture(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  await fixture.db.pool.query(`
    CREATE SCHEMA IF NOT EXISTS private;
    ALTER TABLE public.merchant_feature_settings ADD COLUMN IF NOT EXISTS shipping_providers jsonb DEFAULT '[]';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
  `);
  await fixture.db.pool.query(
    readFileSync(
      new URL(
        '../../../../supabase/migrations/20260713120001_merchant_shipping_zones_and_rates.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  const policy = readFileSync(
    new URL(
      '../../../../supabase/migrations/20260921100200_enforce_merchant_shipping_provider_policy.sql',
      import.meta.url
    ),
    'utf8'
  );
  const start = policy.indexOf(
    'CREATE OR REPLACE FUNCTION private.supported_carrier_provider_ids()'
  );
  const end = policy.indexOf('$$;', start);
  if (start < 0 || end < 0) throw Error('MISSING_SHIPPING_PROVIDER_POLICY');
  await fixture.db.pool.query(policy.slice(start, end + 3));
  await fixture.db.pool.query(
    'REVOKE ALL ON FUNCTION private.supported_carrier_provider_ids() FROM PUBLIC, anon, authenticated, service_role'
  );
  await fixture.db.pool.query(
    readFileSync(
      new URL(
        '../../../../supabase/migrations/20261106150100_merchant_shipping_config_revision.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  for (const name of [
    '20261106160000_fix_shipping_location_revision_trigger.sql',
    '20261106170000_harden_shipping_revision_tenant_integrity.sql',
  ])
    await fixture.db.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8'
      )
    );
  await fixture.db.pool.query("NOTIFY pgrst, 'reload schema'");
}
