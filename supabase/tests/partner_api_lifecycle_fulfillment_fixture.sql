-- Extend the isolated partner API schema with fields read by the real GIG
-- quote binder. Quote prices, wallet balance and staff identity are fixtures.
ALTER TABLE public.shipping_quotes
  ADD COLUMN pricing_version text,
  ADD COLUMN provider_cost numeric,
  ADD COLUMN platform_margin numeric,
  ADD COLUMN carrier_name text,
  ADD COLUMN estimated_days int,
  ADD COLUMN min_days int,
  ADD COLUMN max_days int,
  ADD COLUMN pickup_included boolean,
  ADD COLUMN insurance_included boolean,
  ADD COLUMN station_name text,
  ADD COLUMN station_address text,
  ADD COLUMN created_at timestamptz DEFAULT now();

ALTER TABLE public.shipping_quote_attestations
  ADD COLUMN pricing_version text,
  ADD COLUMN provider_cost numeric,
  ADD COLUMN platform_margin numeric,
  ADD COLUMN is_station_pickup boolean;

CREATE TABLE public.merchant_shipping_charges (order_id uuid, status text);
CREATE TABLE public.merchant_wallets (merchant_id uuid, available_balance numeric);
INSERT INTO public.merchant_wallets VALUES ('7a100000-0000-4000-8000-000000000001', 3000);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('baci_fixture.staff', true), '')::uuid;
$$;

CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT $1 = '7a100000-0000-4000-8000-000000000101'::uuid
    AND $2 = '7a100000-0000-4000-8000-000000000001'::uuid
    AND $3 = 'orders' AND $4 IN ('fulfill', 'edit');
$$;

CREATE FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric; $$;

CREATE FUNCTION private.seed_fixture_gigl_quote(
  p_order_id uuid, p_price numeric, p_service text DEFAULT 'Standard',
  p_destination_override jsonb DEFAULT '{}',
  p_sender_override jsonb DEFAULT '{}', p_weight_delta numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_quote_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shipping_quotes (
    id, merchant_id, provider, currency, session_id, expires_at, used,
    is_station_pickup, price, provider_rate_id, quote_request,
    pricing_version, provider_cost, platform_margin, service_tier
  )
  SELECT v_quote_id, o.merchant_id, 'GIGL', 'NGN', o.id::text,
    now() + interval '5 minutes', false, false, p_price, 'fixture-dispatch-rate',
    jsonb_build_object(
      'shipmentType', 'domestic',
      'admin_order_provenance', 'server_gigl_v1',
      'receiver', o.shipping_address || p_destination_override,
      'sender', (q.snapshot #> '{carrier_quote,quote_request,sender}') || p_sender_override,
      'items', (SELECT jsonb_agg(jsonb_set(item, '{weight}',
        to_jsonb((item->>'weight')::numeric + p_weight_delta)))
        FROM jsonb_array_elements(q.snapshot #> '{carrier_quote,quote_request,items}') AS item)
    ),
    'gigl_platform_margin_v1', 1000, p_price - 1000, p_service
  FROM public.orders o
  JOIN private.accepted_partner_orders a ON a.order_id = o.id
  JOIN private.partner_order_submissions s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes q ON q.id = s.quote_id
  WHERE o.id = p_order_id;

  INSERT INTO public.shipping_quote_attestations (
    quote_id, merchant_id, order_id, price, currency, provider_rate_id, quote_request,
    expires_at, pricing_version, provider_cost, platform_margin, is_station_pickup
  )
  SELECT id, merchant_id, p_order_id, price, currency, provider_rate_id, quote_request,
    expires_at, pricing_version, provider_cost, platform_margin, is_station_pickup
  FROM public.shipping_quotes WHERE id = v_quote_id;
  RETURN v_quote_id;
END;
$$;
