-- Regression checks for the chat Paystack account fence.
-- Synthetic rows only; everything rolls back.
--
-- Usage:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/chat_paystack_dva_attempts.sql

BEGIN;

SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'dva-fence-owner@example.com');
INSERT INTO public.merchants (id, email, user_id, country)
VALUES ('11111111-1111-4111-8111-111111111111', 'dva-fence@example.com',
  '22222222-2222-4222-8222-222222222222', 'NG');

CREATE FUNCTION pg_temp.make_order(p_id uuid, p_number text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.orders (id, merchant_id, order_number, total, currency,
    payment_method, payment_status, customer_email, tracking_token,
    checkout_idempotency_key)
  VALUES (p_id, '11111111-1111-4111-8111-111111111111', p_number, 5000.00, 'NGN',
    'bank_transfer', 'unpaid', 'shopper@example.com', 'token-' || p_number,
    'cw-chk-' || encode(sha256(convert_to(p_number, 'UTF8')), 'hex'));
$$;

CREATE FUNCTION pg_temp.begin_attempt(p_order uuid, p_token text, p_ref text, p_want text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  o public.orders%ROWTYPE;
  kind text;
BEGIN
  -- Read what the replayed order triggers actually stored.
  SELECT * INTO o FROM public.orders WHERE id = p_order;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated',
    'paystack_dva_attempt', jsonb_build_object(
      'order_id', p_order,
      'merchant_id', o.merchant_id,
      'customer_email', lower(btrim(o.customer_email)),
      'amount_kobo', (o.total * 100)::bigint::text,
      'reference', p_ref)
  )::text, true);
  kind := public.begin_chat_paystack_dva_attempt(o.tracking_token)->>'kind';
  -- Distinct SQLSTATE so a replay failure names the unexpected receipt.
  IF kind IS NULL OR kind IN ('refused', 'legacy') THEN
    RAISE EXCEPTION 'unexpected receipt %', coalesce(kind, 'null')
      USING ERRCODE = 'ZK' || upper(left(coalesce(kind, 'nul'), 3));
  END IF;
  IF p_want IS NOT NULL AND kind IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'receipt % but wanted %', kind, p_want
      USING ERRCODE = 'Z' || right(p_ref, 1) || upper(left(kind, 3));
  END IF;
  RETURN kind;
END;
$$;

-- 1. An account row with no assigned_at may be a legacy live account: fence it.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000001', 'FENCE-1');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name,
  account_name, provider, assigned_at, expires_at)
VALUES ('a0000000-0000-4000-8000-000000000001', '0000000001', 'Test Bank',
  'Test Name', 'paystack', NULL, NULL);
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000001',
       'token-FENCE-1', 'BAC-AAAAAAAAAAA1', 'pending') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'account with NULL assigned_at must stay fenced';
  END IF;
  IF EXISTS (SELECT 1 FROM private.chat_paystack_dva_attempts
    WHERE order_id = 'a0000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'fenced account must not create a claim';
  END IF;
END $$;

-- 2. NULL expires_at falls back to the 90 minute ceiling.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000002', 'FENCE-2');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name,
  account_name, provider, assigned_at, expires_at, assignment_customer_email,
  payable_amount)
VALUES ('a0000000-0000-4000-8000-000000000002', '0000000002', 'Test Bank',
  'Test Name', 'paystack', clock_timestamp() - interval '5 minutes', NULL,
  'shopper@example.com', 5000.00);
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000002',
       'token-FENCE-2', 'BAC-AAAAAAAAAAA2', 'pending') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'live account without expires_at must not be re-claimed';
  END IF;
END $$;

-- 3. An older expired alias must not hide the newer live one.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000003', 'FENCE-3');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name,
  account_name, provider, assigned_at, expires_at, assignment_customer_email,
  payable_amount)
VALUES
  ('a0000000-0000-4000-8000-000000000003', '0000000031', 'Test Bank',
   'Test Name', 'paystack', clock_timestamp() - interval '5 hours',
   clock_timestamp() - interval '4 hours', 'shopper@example.com', 5000.00),
  ('a0000000-0000-4000-8000-000000000003', '0000000032', 'Test Bank',
   'Test Name', 'paystack', clock_timestamp() - interval '5 minutes',
   clock_timestamp() + interval '1 hour', 'shopper@example.com', 5000.00);
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000003',
       'token-FENCE-3', 'BAC-AAAAAAAAAAA3') = 'claimed' THEN
    RAISE EXCEPTION 'a live alias must block a second account request';
  END IF;
END $$;

-- 4. Only an expired alias lets the first request claim, and a repeat is fenced.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000004', 'FENCE-4');
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000004',
       'token-FENCE-4', 'BAC-AAAAAAAAAAA4', 'claimed') IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'first request without any account must claim';
  END IF;
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000004',
       'token-FENCE-4', 'BAC-AAAAAAAAAAA5', 'pending') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'an unresolved claim must stay fenced';
  END IF;
END $$;

-- 5. Release stays blocked while the claim is fresh or a NULL-assigned row exists.
DO $$ BEGIN
  IF private.release_unfulfilled_chat_paystack_dva_attempt(
       'a0000000-0000-4000-8000-000000000004', 'BAC-AAAAAAAAAAA4') THEN
    RAISE EXCEPTION 'fresh claim must not be released';
  END IF;
  UPDATE private.chat_paystack_dva_attempts
    SET claimed_at = clock_timestamp() - interval '1 hour'
    WHERE order_id = 'a0000000-0000-4000-8000-000000000004';
  IF NOT private.release_unfulfilled_chat_paystack_dva_attempt(
       'a0000000-0000-4000-8000-000000000004', 'BAC-AAAAAAAAAAA4') THEN
    RAISE EXCEPTION 'old claim with no account must be releasable';
  END IF;
END $$;

-- 6. Older expired aliases must not block releasing a stuck claim.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000006', 'FENCE-6');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name,
  account_name, provider, assigned_at, expires_at, assignment_customer_email,
  payable_amount)
VALUES
  ('a0000000-0000-4000-8000-000000000006', '0000000061', 'Test Bank',
   'Test Name', 'paystack', clock_timestamp() - interval '9 hours',
   clock_timestamp() - interval '8 hours', 'shopper@example.com', 5000.00),
  ('a0000000-0000-4000-8000-000000000006', '0000000062', 'Test Bank',
   'Test Name', 'paystack', clock_timestamp() - interval '5 hours',
   clock_timestamp() - interval '4 hours', 'shopper@example.com', 5000.00);
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000006',
       'token-FENCE-6', 'BAC-AAAAAAAAAAA6', 'claimed') IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'expired aliases must allow a fresh claim';
  END IF;
  UPDATE private.chat_paystack_dva_attempts
    SET claimed_at = clock_timestamp() - interval '1 hour'
    WHERE order_id = 'a0000000-0000-4000-8000-000000000006';
  IF NOT private.release_unfulfilled_chat_paystack_dva_attempt(
       'a0000000-0000-4000-8000-000000000006', 'BAC-AAAAAAAAAAA6') THEN
    RAISE EXCEPTION 'older alias history must not block release';
  END IF;
END $$;

-- 7. A legacy row with no assigned_at fences the order even beside a dated expired alias.
SELECT pg_temp.make_order('a0000000-0000-4000-8000-000000000007', 'FENCE-7');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name,
  account_name, provider, assigned_at, expires_at)
VALUES
  ('a0000000-0000-4000-8000-000000000007', '0000000071', 'Test Bank',
   'Test Name', 'paystack', NULL, NULL),
  ('a0000000-0000-4000-8000-000000000007', '0000000072', 'Test Bank',
   'Test Name', 'paystack', clock_timestamp() - interval '5 hours',
   clock_timestamp() - interval '4 hours');
DO $$ BEGIN
  IF pg_temp.begin_attempt('a0000000-0000-4000-8000-000000000007',
       'token-FENCE-7', 'BAC-AAAAAAAAAAA7') = 'claimed' THEN
    RAISE EXCEPTION 'a legacy NULL-assigned row must block a new claim';
  END IF;
END $$;

ROLLBACK;
