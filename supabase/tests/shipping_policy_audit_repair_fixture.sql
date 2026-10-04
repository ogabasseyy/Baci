CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
CREATE TABLE public.audit_events (
  id uuid, occurred_at timestamptz, database_transaction_id text,
  merchant_id uuid, merchant_label text, actor_user_id uuid, actor_type text, actor_label text,
  action text, resource_type text, resource_id text, changed_fields text[],
  before_values jsonb, after_values jsonb, source text, correlation_id uuid,
  request_id uuid, schema_version smallint, metadata jsonb
);
CREATE TABLE private.audit_event_writer_capabilities(capability uuid, capability_name text);
INSERT INTO private.audit_event_writer_capabilities VALUES
  ('10000000-0000-4000-8000-000000000001', 'canonical_audit_event_writer_v1');
CREATE TABLE public.merchants(id uuid PRIMARY KEY, payout_currency text, country text);
CREATE TABLE public.merchant_feature_settings(id uuid PRIMARY KEY, merchant_id uuid, shipping_providers jsonb);
CREATE TABLE public.merchant_shipping_zones(id uuid, merchant_id uuid, name text, is_rest_of_world boolean, active boolean);
CREATE TABLE public.merchant_shipping_zone_locations(zone_id uuid, country_code text, subdivision_code text);
CREATE TABLE public.merchant_shipping_rates(
  id uuid, merchant_id uuid, zone_id uuid, name text, kind text, currency text, base_amount numeric,
  condition_type text, min_subtotal numeric, max_subtotal numeric, free_over_amount numeric,
  delivery_min_days integer, delivery_max_days integer, pickup_address text, sort_order integer, active boolean
);
CREATE TABLE public.orders(id uuid, merchant_id uuid, shipping_provider text, selected_quote_id uuid, fulfillment_type text);
-- Minimal trigger adapter calls the real canonical audit writer loaded by the test.
CREATE FUNCTION private.audit_shipping_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM private.write_audit_event_v1(
    NEW.merchant_id, 'Fixture Merchant', 'settings.updated', 'merchant_feature_settings', NEW.id::text,
    ARRAY['shipping_providers'], jsonb_build_object('shipping_providers', OLD.shipping_providers),
    jsonb_build_object('shipping_providers', NEW.shipping_providers), NULL::uuid, NULL::uuid,
    1::smallint, '{}'::jsonb, '10000000-0000-4000-8000-000000000001'::uuid
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER shipping_audit AFTER UPDATE ON public.merchant_feature_settings
  FOR EACH ROW EXECUTE FUNCTION private.audit_shipping_fixture();
INSERT INTO public.merchants VALUES ('20000000-0000-4000-8000-000000000001', 'NGN', 'NG');
INSERT INTO public.merchant_feature_settings VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '[" GIGL ", "shiip", "topship", "gigl"]'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '["gigl"]');
