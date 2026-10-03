-- Minimal disposable PostgreSQL fixture; no live merchant/customer data.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, deleted_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid, slug text, business_name text, email text, phone text, support_email text, support_phone text, bank_code text, bank_account_number text, bank_name text, bank_account_name text, legal_entity_name text, business_address text, registered_address jsonb, cac_rc_number text, tax_identification_number text, vat_registration_status text, vat_rate numeric);
CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid REFERENCES public.merchants, user_id uuid, email text, total_orders integer DEFAULT 0, total_spent numeric DEFAULT 0, last_login_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
-- Mirror the production unique index (baseline 20260418000000): it covers
-- soft-deleted rows, so redemption tests prove link-failure handling instead
-- of silently double-linking.
CREATE UNIQUE INDEX idx_customers_merchant_user ON public.customers (merchant_id, user_id) WHERE user_id IS NOT NULL;
CREATE TABLE public.staff_members (merchant_id uuid, user_id uuid, status text);
CREATE TABLE public.import_jobs (id uuid PRIMARY KEY, merchant_id uuid, status text);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid REFERENCES public.merchants,
  customer_id uuid REFERENCES public.customers, customer_email text, customer_name text,
  customer_phone text, order_number text, recorded_by_user_id uuid, import_job_id uuid, external_source text,
  created_at timestamptz DEFAULT now(), payment_status text DEFAULT 'unpaid', shipping_status text DEFAULT 'pending',
  total numeric DEFAULT 100, subtotal numeric DEFAULT 0, shipping_fee numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0, discount_amount numeric DEFAULT 0, amount_paid numeric DEFAULT 0,
  currency text DEFAULT 'NGN', payment_method text, invoice_type_code text, invoice_note text, notes text,
  transaction_date timestamptz, invoice_issue_date date, shipping_address jsonb,
  fulfillment_notification_cycle_id uuid DEFAULT gen_random_uuid(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders ON DELETE CASCADE, name text, quantity integer, price numeric, variant_name text, condition text, item_description text, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_payment_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders ON DELETE CASCADE, account_number text, bank_name text, account_name text, provider text, assignment_customer_email_source text, expires_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_tax_subtotals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders ON DELETE CASCADE, vat_category_code text, vat_rate numeric, taxable_amount numeric, tax_amount numeric, exemption_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders ON DELETE CASCADE, transaction_type text, amount numeric, currency text, status text, gateway text, gateway_reference text, description text, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.domains (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid REFERENCES public.merchants, domain text, domain_type text, status text DEFAULT 'pending', is_primary boolean DEFAULT false, ssl_status text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.order_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.orders ON DELETE CASCADE,
  merchant_id uuid REFERENCES public.merchants,
  event_type text NOT NULL CHECK (event_type IN ('order_shipped', 'order_delivered')),
  status text NOT NULL DEFAULT 'pending', attempt_count integer DEFAULT 0, max_attempts integer DEFAULT 5,
  next_attempt_at timestamptz, locked_at timestamptz, locked_by text, last_error text, skip_reason text,
  metadata jsonb DEFAULT '{}', sent_at timestamptz, skipped_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  event_sequence bigserial, dispatch_started_at timestamptz,
  fulfillment_cycle_id uuid NOT NULL,
  UNIQUE (order_id, event_type, fulfillment_cycle_id)
);
ALTER TABLE public.order_notification_outbox ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.orders, public.order_items, public.customers, public.order_notification_outbox TO service_role;
GRANT USAGE ON SCHEMA public, auth, private TO service_role, authenticated, anon;
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

-- An existing manual order must not be mailed just because its items are edited.
INSERT INTO public.merchants (id, user_id, slug, business_name, email, legal_entity_name, business_address, registered_address, cac_rc_number, tax_identification_number, vat_registration_status, vat_rate) VALUES ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'fixture', 'Fixture', 'store@example.com', 'Fixture Ltd', '1 Market St', '{"city": "Lagos"}', 'RC123', 'TIN123', 'registered', 7.5);
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'buyer@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, customer_name, order_number, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'Buyer', 'OLD', 'paid', 100);
