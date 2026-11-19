-- Synthetic, isolated data for the GIG merchant-wallet staff-access suite.
-- Loaded after shipping_quote_proof_fixture.sql (merchants, orders, quotes,
-- attestations, staff_members and the real permission helpers).
ALTER TABLE public.orders
  ADD COLUMN shipping_provider text,
  ADD COLUMN shipping_address jsonb;
ALTER TABLE public.shipping_quotes
  ADD COLUMN used boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY, order_id uuid, name text, quantity integer, price numeric
);
CREATE FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric $$;

CREATE TABLE public.merchant_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid UNIQUE,
  available_balance numeric NOT NULL DEFAULT 0, total_earned numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, merchant_id uuid,
  type text, amount numeric, balance_after numeric, source_type text,
  source_id uuid, description text, status text
);
CREATE TABLE public.merchant_shipping_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid, order_id uuid,
  shipping_quote_id uuid, currency text, charged_amount numeric,
  provider_cost numeric, platform_margin numeric, attempt_token_digest text,
  debit_transaction_id uuid, status text NOT NULL DEFAULT 'reserved',
  provider_submitting_at timestamptz, failure_code text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.merchant_wallet_funding_account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.merchant_wallet_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL,
  request_id uuid, provider text NOT NULL DEFAULT 'paystack',
  provider_account_id text, provider_customer_code text,
  account_number text NOT NULL, account_name text, bank_name text,
  currency text NOT NULL DEFAULT 'NGN', status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Production policies and grants before the fulfil-staff migration.
ALTER TABLE public.merchant_wallet_funding_account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_wallet_payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_wallet_request_owner ON public.merchant_wallet_funding_account_requests
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = auth.uid()));
CREATE POLICY merchant_wallet_request_owner_insert ON public.merchant_wallet_funding_account_requests
  FOR INSERT TO authenticated WITH CHECK (status = 'pending' AND EXISTS (
    SELECT 1 FROM public.merchants AS m
    WHERE m.id = merchant_wallet_funding_account_requests.merchant_id
      AND m.user_id = auth.uid()));
CREATE POLICY merchant_wallet_account_owner ON public.merchant_wallet_payment_accounts
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = auth.uid()));
GRANT SELECT, INSERT ON public.merchant_wallet_funding_account_requests TO authenticated;
GRANT SELECT ON public.merchant_wallet_payment_accounts TO authenticated;
GRANT SELECT ON public.staff_members TO authenticated;

-- Merchant 1 (owner 2...1): a processing order ready to bind, and a
-- wallet-funded order already bound to an attested quote.
UPDATE public.orders SET shipping_funding_source = NULL, shipping_provider = 'GIGL',
  shipping_address = '{"name":"Ada","phone":"08000000000","address":"12 Test Street","city":"Ikeja","state":"Lagos"}'
  WHERE id = '40000000-0000-4000-8000-000000000001';
INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status,
  shipping_funding_source, shipping_provider, selected_quote_id,
  shipping_provider_cost, shipping_platform_margin, shipping_pricing_version)
VALUES ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'paid', 'processing', 'merchant_wallet', 'GIGL', '70000000-0000-4000-8000-000000000002',
  100, 10, 'gigl_platform_margin_v1');
INSERT INTO public.order_items VALUES
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Phone', 1, 1000);
INSERT INTO public.shipping_quotes (id, merchant_id, session_id, provider,
  service_tier, carrier_name, price, provider_cost, platform_margin,
  pricing_version, currency, is_station_pickup, provider_rate_id, expires_at,
  quote_request)
SELECT q.id, '10000000-0000-4000-8000-000000000001', q.order_id, 'GIGL',
  'standard', 'GIG Logistics', 110, 100, 10, 'gigl_platform_margin_v1', 'NGN',
  false, 'rate-1', now() + interval '1 hour',
  '{"receiver":{"name":"Ada","phone":"08000000000","address":"12 Test Street","city":"Ikeja","state":"Lagos"},"items":[{"name":"Phone","quantity":1,"value":1000}]}'::jsonb
FROM (VALUES
  ('70000000-0000-4000-8000-000000000001'::uuid, '40000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002'::uuid, '40000000-0000-4000-8000-000000000002')
) AS q(id, order_id);
INSERT INTO public.shipping_quote_attestations (quote_id, order_id, merchant_id,
  price, provider_cost, platform_margin, currency, pricing_version, expires_at,
  is_station_pickup, provider_rate_id, quote_request)
SELECT id, session_id::uuid, merchant_id, price, provider_cost, platform_margin,
  currency, pricing_version, expires_at, is_station_pickup, provider_rate_id,
  quote_request
FROM public.shipping_quotes WHERE id IN (
  '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002');
INSERT INTO public.merchant_wallets (merchant_id, available_balance) VALUES
  ('10000000-0000-4000-8000-000000000001', 500);
INSERT INTO public.merchant_wallet_payment_accounts (merchant_id, account_number,
  account_name, bank_name, provider_account_id, provider_customer_code, metadata)
VALUES ('10000000-0000-4000-8000-000000000001', '1234567890', 'Shop', 'Bank',
  'provider-secret-id', 'CUS_secret', '{"private":true}');
INSERT INTO public.merchant_wallet_funding_account_requests (id, merchant_id)
VALUES ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
