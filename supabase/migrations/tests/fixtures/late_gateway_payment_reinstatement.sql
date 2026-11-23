DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres SUPERUSER;
  END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid, user_id uuid);
CREATE TABLE public.orders(
 id uuid PRIMARY KEY, merchant_id uuid, customer_id uuid,
 customer_email text DEFAULT (gen_random_uuid()::text || '@example.test'), customer_phone text,
 source text DEFAULT 'mobile_app', recorded_by_user_id uuid, total numeric DEFAULT 150,
 currency text DEFAULT 'NGN', payment_method text DEFAULT 'credit_direct',
 payment_status text DEFAULT 'bnpl_pending', shipping_status text DEFAULT 'pending',
 created_at timestamptz DEFAULT now() - interval '4 days',
 updated_at timestamptz DEFAULT now() - interval '4 days', cancelled_at timestamptz,
 cancelled_by text, cancellation_reason text, cancellation_refund_mode text,
 paid_transaction_id uuid, paid_at timestamptz, amount_paid numeric DEFAULT 0,
 wallet_amount_used numeric, is_credit_order boolean, discount_amount numeric, notes text
);
CREATE TABLE public.transactions(
 id uuid PRIMARY KEY, order_id uuid, merchant_id uuid, transaction_type text DEFAULT 'payment',
 status text DEFAULT 'completed', gateway text, gateway_reference text,
 gateway_response jsonb DEFAULT '{"status":"success"}',
 currency text DEFAULT 'NGN', amount numeric DEFAULT 150, merchant_amount numeric DEFAULT 149, platform_fee numeric DEFAULT 1
);
CREATE TABLE public.oxygen_workflows(order_id uuid);
CREATE TABLE public.reward_redemptions(used_on_order_id uuid);
CREATE TABLE public.reconciliation_review(order_id uuid, txn_id uuid, issue_type text, metadata jsonb, resolved_at timestamptz, resolution_notes text);
CREATE TABLE public.payment_side_effects(
 order_id uuid, transaction_id uuid, step text, status text,
 claimed_by text, error text, result jsonb, PRIMARY KEY (order_id, step)
);
CREATE TABLE public.order_refund_events(order_id uuid);
CREATE TABLE public.order_cancellation_side_effects(order_id uuid);
CREATE TABLE public.paystack_refund_recovery_watch(paystack_ref text, status text);
CREATE TABLE public.products(id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.product_variants(id uuid, product_id uuid, merchant_id uuid);
CREATE TABLE public.order_items(order_id uuid, product_id uuid, variant_id uuid);
CREATE FUNCTION public.claim_paystack_refund_recovery_watches_v1(uuid, uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE TABLE private.inventory_test_effects(order_id uuid);
CREATE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO private.inventory_test_effects VALUES ($2);
  IF current_setting('baci.test_missing_inventory', true) = 'on' THEN
    RETURN '{"missingUnitCount":1,"exceptionCodes":[{"code":"late_payment_reservation_lost"}]}'::jsonb;
  END IF;
  IF current_setting('baci.test_inventory_unlimited', true) = 'on' THEN
    RETURN '{"missingUnitCount":1,"reclaimedUnitCount":1,"exceptionCodes":[]}'::jsonb;
  END IF;
  RETURN '{"missingUnitCount":0,"reclaimedUnitCount":0,"exceptionCodes":[]}'::jsonb;
END; $$;
