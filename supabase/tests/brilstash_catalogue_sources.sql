-- Disposable database only; run via psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('brilstash_feed_ingress_key', repeat('a', 64));
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY, is_published boolean, payout_currency text, user_id uuid, slug text);
CREATE TABLE public.domains (merchant_id uuid, domain text, status text);
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.products(
  id uuid PRIMARY KEY, merchant_id uuid, status text, name text, slug text,
  brand text, mpn text, category_id uuid, condition text, price numeric,
  has_variants boolean, variant_model text, has_condition_offers boolean,
  stock_quantity integer, stock integer, manage_stock boolean, inventory_tracking_policy text,
  inventory_anchor_variant_id uuid, images jsonb
);
CREATE TABLE public.product_variants(
  id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, condition text,
  attributes jsonb, is_inventory_anchor boolean, price_override numeric,
  stock_quantity integer, inventory_tracking_policy text
);
CREATE TABLE public.product_offers(
  id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, condition text, status text,
  price numeric, stock_quantity integer, images jsonb
);
CREATE TABLE public.categories(id uuid PRIMARY KEY, merchant_id uuid, is_active boolean);
CREATE TABLE public.product_categories(product_id uuid, category_id uuid);
CREATE FUNCTION public.feed_manifest_image_urls(images jsonb)
RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_array_elements_text(images) $$;
CREATE TABLE public.product_feed_images(
  id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, variant_id uuid,
  status text, verified_url text, is_primary boolean, position integer, source_url text
);
CREATE SCHEMA private;
CREATE FUNCTION private.get_public_serialized_variant_availability_counts(uuid, uuid[], uuid)
RETURNS TABLE(product_id uuid, variant_id uuid, public_available_units integer)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF current_setting('fixture.serialized_count_error', true) = 'true' THEN
    RAISE EXCEPTION 'fixture availability failed' USING ERRCODE = '22000';
  END IF;
  RETURN;
END;
$$;
\ir ../migrations/20261119010141_brilstash_catalogue_storage.sql
\ir ../migrations/20261119010330_brilstash_catalogue_assortment.sql
\ir ../migrations/20261119010611_brilstash_catalogue_sources.sql
\ir ../migrations/20261119011048_brilstash_catalogue_staging.sql
\ir ../migrations/20261119011502_brilstash_catalogue_activation.sql
\ir ../migrations/20261119011722_brilstash_catalogue_suspension.sql
\ir ../migrations/20261119011829_brilstash_catalogue_reader.sql
\ir ../migrations/20261119012330_brilstash_catalogue_promotion.sql
\ir ../migrations/20261119012640_brilstash_released_attempts.sql
\ir ../migrations/20261119012935_brilstash_catalogue_recovery.sql
\ir ../migrations/20261119013300_brilstash_catalogue_setup.sql
\ir ../migrations/20261119014311_brilstash_catalogue_probe_state.sql
\ir ../migrations/20261119014902_brilstash_catalogue_handoff.sql
\ir ../migrations/20261119015846_brilstash_stock_withdrawal.sql
\ir ../migrations/20261119020052_brilstash_enablement_readback.sql
\ir ../migrations/20261119020317_brilstash_installation_retirement.sql
\ir ../migrations/20261119021534_brilstash_listing_source_remap.sql
\ir ../migrations/20261119022000_brilstash_activation_stock_guards.sql
\ir ../migrations/20261119023000_brilstash_generation_and_binding_guards.sql
\ir ../migrations/20261119023100_brilstash_require_ingress_proof.sql
\ir ../migrations/20261119121800_brilstash_bind_payload_display.sql
\ir ../migrations/20261119121900_brilstash_revalidate_storefront_and_ingress.sql
\ir ../migrations/20261119122000_brilstash_align_wire_shape.sql
\ir ../migrations/20261119122100_brilstash_revalidate_served_product_paths.sql
\ir ../migrations/20261119122200_brilstash_guard_drain_abort_freshness.sql
\ir ../migrations/20261119122300_brilstash_pin_activation_prerequisites.sql
\ir ../migrations/20261119122400_brilstash_align_image_identity_and_activation_clock.sql
\ir ../migrations/20261119122500_brilstash_normalize_image_dns_root.sql
\ir ../migrations/20261119122600_brilstash_require_selectable_offer_condition.sql
\ir ../migrations/20261119122700_brilstash_align_inventory_and_image_port.sql
\ir ../migrations/20261119122800_brilstash_require_decremented_scalar_stock.sql
\ir ../migrations/20261127121814_brilstash_source_on_demand.sql
\ir ../migrations/20261127124914_brilstash_partner_price_floor.sql
\ir brilstash_catalogue_privileges.sql
\ir brilstash_catalogue_digest.sql
CREATE SCHEMA fixture;
GRANT USAGE ON SCHEMA fixture TO anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO anon;
CREATE FUNCTION fixture.brilstash_digest(payload jsonb)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(private.brilstash_canonical_json(payload), 'UTF8')), 'hex')
$$;
CREATE FUNCTION fixture.read_brilstash_page(bearer text, page integer, page_size integer, min_price numeric,
  proof_bearer text DEFAULT NULL, proof_age_seconds integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE prior_headers text := current_setting('request.headers', true);
DECLARE issued text := floor(extract(epoch FROM statement_timestamp()))::bigint::text;
DECLARE signature text;
DECLARE result jsonb;
BEGIN
  issued := (issued::bigint - proof_age_seconds)::text;
  signature := encode(extensions.hmac(
    'baci:brilstash-feed:v1:' || issued || ':' || COALESCE(proof_bearer, bearer), repeat('a', 64), 'sha256'
  ), 'hex');
  PERFORM set_config('request.headers', jsonb_build_object(
    'x-baci-brilstash-ingress', issued || '.' || signature
  )::text, true);
  result := public.read_brilstash_page(bearer, page, page_size, min_price);
  PERFORM set_config('request.headers', COALESCE(prior_headers, ''), true);
  RETURN result;
END;
$$;

INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.merchants VALUES ('20000000-0000-4000-8000-000000000001', true, 'NGN', '10000000-0000-4000-8000-000000000002', 'fixture-shop'),
  ('20000000-0000-4000-8000-000000000002', true, 'NGN', NULL, 'other-shop');
INSERT INTO public.domains VALUES
  ('20000000-0000-4000-8000-000000000001', 'shop.example.invalid', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'other.example.invalid', 'active');
DO $$
BEGIN
  IF private.brilstash_host_belongs_to_merchant(
    '20000000-0000-4000-8000-000000000001', 'www.shop.example.invalid'
  ) IS DISTINCT FROM true OR private.brilstash_host_belongs_to_merchant(
    '20000000-0000-4000-8000-000000000001', 'www.other.example.invalid'
  ) IS DISTINCT FROM false THEN RAISE EXCEPTION 'product URL ownership diverged from storefront www routing'; END IF;
END $$;

INSERT INTO private.brilstash_installations (id, merchant_id, partner_identity)
VALUES ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'fixture-one'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'fixture-two');
INSERT INTO private.brilstash_builder_entitlements VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

INSERT INTO public.categories VALUES
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', true);
INSERT INTO public.products (
  id, merchant_id, status, name, slug, category_id, condition, price,
  has_variants, variant_model, has_condition_offers, stock_quantity, stock, manage_stock, inventory_tracking_policy
) VALUES
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'active', 'Fixture phone', 'fixture-phone', '50000000-0000-4000-8000-000000000001', 'new', 350000,
     true, 'sku_matrix', false, 3, 3, true, 'off'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
    'active', 'Other tenant product', 'other-product', NULL, 'new', 900000,
     false, NULL, false, 2, 2, true, 'off');
INSERT INTO public.product_variants (
  id, merchant_id, product_id, condition, attributes, is_inventory_anchor, price_override, stock_quantity, inventory_tracking_policy
) VALUES
  ('40000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','new','{"storage":"128GB"}',false,365000,0,'inherit');
INSERT INTO private.brilstash_listings (
    id, installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
) VALUES
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'variant', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001',
   'fixture-one', 1, '{"condition":"new","attributes":{"storage":"128GB"}}'),
  ('60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'product', '40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   'wrong-tenant', 2, '{"condition":"new"}');

INSERT INTO private.brilstash_listing_facts (
  installation_id, listing_id, revision, specifications, box_contents, warranty, evidence_reference, reviewed_by
) VALUES ('30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1,
          '128GB', 'Phone only', '30 days', 'private-proof', '10000000-0000-4000-8000-000000000001');
UPDATE private.brilstash_listings SET approved_facts_revision = 1
WHERE id = '60000000-0000-4000-8000-000000000001';
INSERT INTO private.brilstash_category_mappings VALUES
  ('30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Phones');
INSERT INTO public.product_feed_images VALUES
  ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011',
   'verified','https://media.example.invalid/approved',true,1,'https://media.example.invalid/approved'),
  ('80000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011',
   'stale','https://media.example.invalid/stale',false,2,'https://media.example.invalid/stale');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
DO $$
DECLARE result jsonb;
BEGIN
  result := public.load_brilstash_catalogue_sources('30000000-0000-4000-8000-000000000001');
  IF result->'rows'->0->>'priceNaira' IS DISTINCT FROM '365000'
    OR result->'rows'->0->'inventory'->>'units' IS DISTINCT FROM '0'
    OR result->'rows'->0->'verifiedImages' IS DISTINCT FROM '["https://media.example.invalid/approved"]'::jsonb
    OR result->'rows'->0->>'partnerCategory' IS DISTINCT FROM 'Phones'
    OR result->'rows'->1->>'externalId' IS DISTINCT FROM 'wrong-tenant'
    OR result->'rows'->1->>'visible' IS DISTINCT FROM 'false'
    OR result::text LIKE '%private-proof%'
    OR result::text LIKE '%Other tenant product%'
  THEN RAISE EXCEPTION 'unexpected scoped data: %', result;
  END IF;
  BEGIN
    PERFORM public.load_brilstash_catalogue_sources('30000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'builder loaded another installation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.load_brilstash_catalogue_sources(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.load_brilstash_catalogue_sources(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'non-builder caller has a direct grant';
  END IF;
END $$;

\ir brilstash/serialized-stock.inc.sql
\ir brilstash/staging-and-activation.inc.sql
\ir brilstash/reader.inc.sql
\ir brilstash/probe-state.inc.sql
\set brilstash_on_demand false
\ir brilstash/paged-reader.inc.sql
\set brilstash_on_demand true
\ir brilstash/paged-reader.inc.sql
\ir brilstash/stock-withdrawal.inc.sql
\ir brilstash/source-remap.inc.sql
\ir brilstash/promotion.inc.sql
-- The replacement must be fresh at both the simulated recovery time and
-- the live reader's statement time. Timestamp the fixture before both.
ALTER TABLE private.brilstash_suspensions
  ALTER COLUMN suspended_at SET DEFAULT LEAST(private.brilstash_clock(), statement_timestamp());
\ir brilstash/released-attempts.inc.sql
\ir brilstash/recovery.inc.sql
\ir brilstash/setup.inc.sql
ROLLBACK;
