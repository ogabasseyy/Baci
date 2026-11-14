-- Disposable local synthetic catalog scaffolding. Commerce functions are main's migrations.
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT CASE WHEN auth.jwt()->>'sub' ~ '^[a-f0-9-]{36}$' THEN (auth.jwt()->>'sub')::uuid ELSE NULL END $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),ADD COLUMN IF NOT EXISTS business_name text DEFAULT 'Synthetic Baci Store',ADD COLUMN IF NOT EXISTS business_address text,ADD COLUMN IF NOT EXISTS state_code text DEFAULT 'LA',ADD COLUMN IF NOT EXISTS phone text,ADD COLUMN IF NOT EXISTS email text,ADD COLUMN IF NOT EXISTS template_id text DEFAULT 'new-template',ADD COLUMN IF NOT EXISTS plan_tier text DEFAULT 'business',ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
CREATE FUNCTION public.check_staff_permission(actor uuid,merchant uuid,resource text,action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.merchants WHERE id=merchant AND user_id=actor) $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
CREATE TABLE public.categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),name text,slug text,is_active boolean DEFAULT true,parent_id uuid);
CREATE TABLE public.product_categories(product_id uuid REFERENCES products(id) ON DELETE CASCADE,category_id uuid REFERENCES categories(id));
CREATE TABLE public.branches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),is_active boolean DEFAULT true,is_default boolean DEFAULT true);
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug text,ADD COLUMN IF NOT EXISTS name text DEFAULT 'Synthetic QA Device',ADD COLUMN IF NOT EXISTS description text DEFAULT 'Synthetic local commerce fixture',ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '["/__experience-local-fixture.png"]',ADD COLUMN IF NOT EXISTS category text DEFAULT 'Phones',ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id),ADD COLUMN IF NOT EXISTS canonical_url text,ADD COLUMN IF NOT EXISTS is_parent boolean DEFAULT true,ADD COLUMN IF NOT EXISTS parent_product_id uuid,ADD COLUMN IF NOT EXISTS image_hint text,ADD COLUMN IF NOT EXISTS has_condition_offers boolean DEFAULT false,ADD COLUMN IF NOT EXISTS gtin text DEFAULT '',ADD COLUMN IF NOT EXISTS mpn text DEFAULT '';
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS condition text,ADD COLUMN IF NOT EXISTS sku text,ADD COLUMN IF NOT EXISTS attributes jsonb DEFAULT '{}',ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]',ADD COLUMN IF NOT EXISTS primary_image text,ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS public.merchant_feature_settings(merchant_id uuid PRIMARY KEY REFERENCES merchants(id),shipping_providers jsonb DEFAULT '[]');
CREATE TABLE public.merchant_slug_aliases(old_slug text,merchant_id uuid REFERENCES merchants(id));
CREATE TABLE IF NOT EXISTS public.domains(domain text,merchant_id uuid REFERENCES merchants(id),status text,domain_type text,is_primary boolean);
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_published_merchant ON merchants FOR SELECT TO anon,authenticated USING(is_published IS TRUE OR user_id=auth.uid());
CREATE POLICY fixture_owner_update ON merchants FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT(id,slug,business_name,business_address,state_code,phone,email,template_id,plan_tier,plan_expires_at,premium_features,payout_currency,country,is_published) ON merchants TO anon,authenticated;
GRANT UPDATE(business_address,phone,email) ON merchants TO authenticated;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_products ON products FOR SELECT TO anon,authenticated USING(status='active' AND EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.is_published));
GRANT SELECT(id,merchant_id,slug,name,description,price,status,images,category,category_id,canonical_url,is_parent,parent_product_id,manage_stock,stock,stock_quantity,has_variants,has_condition_offers,brand,gtin,mpn,image_hint,inventory_tracking_policy) ON products TO anon,authenticated;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_categories ON categories FOR SELECT TO anon,authenticated USING(is_active AND EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.is_published));
GRANT SELECT(id,merchant_id,name,slug,is_active,parent_id) ON categories TO anon,authenticated;
GRANT SELECT ON merchant_slug_aliases,domains TO anon,authenticated;
CREATE FUNCTION public.resolve_storefront_auth_merchant(p_identifier text) RETURNS TABLE(id uuid,slug text,business_name text,custom_domain text,is_published boolean) LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT m.id,m.slug,m.business_name,NULL::text,m.is_published FROM merchants m WHERE m.slug=p_identifier AND m.is_published $$;
CREATE FUNCTION public.resolve_storefront_public_snapshot_v2(p_identifier text) RETURNS TABLE(custom_domain text,feature_settings jsonb,merchant_data jsonb,resolution_status text) LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT NULL::text,jsonb_build_object('guest_checkout_enabled',true,'pay_on_delivery_enabled',true,'paystack_enabled',false,'korapay_enabled',false,'credit_direct_enabled',false,'credpal_enabled',false,'juicyway_enabled',false,'shipping_insurance_enabled',false,'shipping_providers','[]'::jsonb),
 CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('id',m.id,'slug',m.slug,'business_name',m.business_name,'business_type','electronics','country','NG','phone',m.phone,'email',m.email,'business_address',m.business_address,'template_id',m.template_id,'is_published',m.is_published,'payout_currency',m.payout_currency,'premium_features',m.premium_features,'shared_cart_enabled',true,'shared_cart_accounts_enabled',false,'shared_cart_realtime_enabled',false,'plan_tier',m.plan_tier,'site_title','Synthetic Baci Store','site_description','Synthetic local-only commerce test','brand_colors',jsonb_build_object('primary','#335577')) ELSE NULL END,
 CASE WHEN m.id IS NULL THEN 'not_found' ELSE 'found' END FROM (SELECT 1) marker LEFT JOIN merchants m ON m.slug=p_identifier AND m.is_published
 $$;
GRANT EXECUTE ON FUNCTION public.resolve_storefront_auth_merchant(text),public.resolve_storefront_public_snapshot_v2(text) TO anon,authenticated;
-- An accidental submission fails even if a test ever bypasses its browser stop.
CREATE FUNCTION public.fixture_no_orders() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_FIXTURE_ORDERS_DISABLED';END $$;
CREATE TRIGGER fixture_no_orders BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION public.fixture_no_orders();

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_variants ON product_variants FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM products p WHERE p.id=product_id AND p.merchant_id=product_variants.merchant_id));
GRANT SELECT(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor) ON product_variants TO anon,authenticated;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_membership ON product_categories FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM products p WHERE p.id=product_id));
GRANT SELECT ON product_categories TO anon,authenticated;

ALTER TABLE merchant_feature_settings ADD COLUMN IF NOT EXISTS shipping_providers jsonb DEFAULT '[]';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS domain_type text;

-- Real build evidence pins the parent origin; fixture schema mirrors that field.

GRANT UPDATE(price) ON products TO authenticated;
CREATE POLICY fixture_owner_product_update ON products FOR UPDATE TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'products','edit')) WITH CHECK(public.check_staff_permission(auth.uid(),merchant_id,'products','edit'));
