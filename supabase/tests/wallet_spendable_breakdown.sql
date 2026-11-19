-- Contract test (20261109130000): get_merchant_wallet_spendable_breakdown.
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

SELECT pg_temp.check(
  p.prosecdef AND p.provolatile = 's',
  'breakdown must be STABLE SECURITY DEFINER')
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.get_merchant_wallet_spendable_breakdown(uuid)'::regprocedure;

SELECT pg_temp.check(
  NOT has_function_privilege('anon', 'public.get_merchant_wallet_spendable_breakdown(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_merchant_wallet_spendable_breakdown(uuid)', 'EXECUTE'),
  'anon must not execute; authenticated may');

SELECT pg_temp.check(
  pg_catalog.pg_get_functiondef(
    'public.get_merchant_wallet_spendable_breakdown(uuid)'::regprocedure)
    LIKE '%merchant_wallet_direct_settled_exposure(wallet.id)%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_merchant_wallet_spendable_breakdown(uuid)'::regprocedure)
    LIKE '%GREATEST%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_merchant_wallet_spendable_breakdown(uuid)'::regprocedure)
    LIKE '%analytics%view%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_merchant_wallet_spendable_breakdown(uuid)'::regprocedure)
    LIKE '%wallet.merchant_id = p_merchant_id%',
  'must floor spendable, subtract exposure, require analytics.view, scope to merchant');

-- Behavioral fixture tests ----------------------------------------------------
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  (
    'e1390000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated',
    'wsb-owner-1@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  ),
  (
    'e1390000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated',
    'wsb-owner-2@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  );

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, paystack_subaccount_code
) VALUES
  (
    'e1390100-0000-4000-8000-000000000001',
    'e1390000-0000-4000-8000-000000000001',
    'wsb-owner-1@example.test', 'WSB Merchant 1', 'wsb-merchant-1', 'ACCT_wsb1'
  ),
  (
    'e1390100-0000-4000-8000-000000000002',
    'e1390000-0000-4000-8000-000000000002',
    'wsb-owner-2@example.test', 'WSB Merchant 2', 'wsb-merchant-2', 'ACCT_wsb2'
  );

INSERT INTO public.merchant_wallets (merchant_id, available_balance) VALUES
  ('e1390100-0000-4000-8000-000000000001', 0),
  ('e1390100-0000-4000-8000-000000000002', 0);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, amount_paid, payment_status,
  shipping_status, payment_method, customer_email
) VALUES
  ('e1390200-0000-4000-8000-000000000001', 'e1390100-0000-4000-8000-000000000001', 'WSB-1', 6000, 6000, 'paid', 'processing', 'card', 'wsb@example.test'),
  ('e1390200-0000-4000-8000-000000000002', 'e1390100-0000-4000-8000-000000000001', 'WSB-2', 4000, 4000, 'paid', 'processing', 'card', 'wsb@example.test'),
  ('e1390200-0000-4000-8000-000000000003', 'e1390100-0000-4000-8000-000000000001', 'WSB-3', 9000, 9000, 'paid', 'processing', 'card', 'wsb@example.test'),
  ('e1390200-0000-4000-8000-000000000004', 'e1390100-0000-4000-8000-000000000002', 'WSB-4', 25000, 25000, 'paid', 'processing', 'card', 'wsb@example.test');

DO $behavioral$
DECLARE
  v_s uuid;
  v_row record;
  v_sqlstate text;
BEGIN
  -- Merchant 1: unreconciled legacy credit (6,000) + Baci integration credit (4,000)
  v_s := public.record_merchant_settlement(
    'e1390100-0000-4000-8000-000000000001', 'order',
    'e1390200-0000-4000-8000-000000000001', 'paystack', 'WSB-REF-1',
    6000, 0, 0, 'Legacy paystack', '{}'::jsonb
  );
  UPDATE public.merchant_settlements SET expected_settlement_date = current_date WHERE id = v_s;

  v_s := public.record_merchant_settlement(
    'e1390100-0000-4000-8000-000000000001', 'order',
    'e1390200-0000-4000-8000-000000000002', 'paystack', 'WSB-REF-2',
    4000, 0, 0, 'Baci integration paystack', '{"paystack_collection":"integration"}'::jsonb
  );
  UPDATE public.merchant_settlements SET expected_settlement_date = current_date WHERE id = v_s;

  -- Merchant 2 distraction rows (must not leak into Merchant 1)
  v_s := public.record_merchant_settlement(
    'e1390100-0000-4000-8000-000000000002', 'order',
    'e1390200-0000-4000-8000-000000000004', 'paystack', 'WSB-REF-4',
    25000, 0, 0, 'Other merchant legacy', '{}'::jsonb
  );
  UPDATE public.merchant_settlements SET expected_settlement_date = current_date WHERE id = v_s;

  PERFORM public.process_due_settlements();

  -- Merchant 1 direct-split history row (9,000 net when platform fee is 0)
  PERFORM public.record_paystack_direct_split_settlement(
    'e1390100-0000-4000-8000-000000000001', 'order',
    'e1390200-0000-4000-8000-000000000003', 'paystack', 'WSB-REF-3',
    9000, 0, 0, 'Direct split order', '{}'::jsonb, 'ACCT_wsb1'
  );

  -- Owner 1 sees exact partition: spendable = 4000, settled_to_bank = 9000, pending_reconciliation = 6000
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'e1390000-0000-4000-8000-000000000001', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"e1390000-0000-4000-8000-000000000001"}', true);

  SELECT * INTO v_row
  FROM public.get_merchant_wallet_spendable_breakdown('e1390100-0000-4000-8000-000000000001');

  PERFORM pg_temp.check(v_row.spendable_balance = 4000,
    'expected spendable 4000, got ' || COALESCE(v_row.spendable_balance::text, '<null>'));
  PERFORM pg_temp.check(v_row.settled_to_bank_total = 9000,
    'expected settled_to_bank 9000, got ' || COALESCE(v_row.settled_to_bank_total::text, '<null>'));
  PERFORM pg_temp.check(v_row.pending_reconciliation_total = 6000,
    'expected pending_reconciliation 6000, got ' || COALESCE(v_row.pending_reconciliation_total::text, '<null>'));

  -- Foreign owner 2 is rejected (no cross-merchant leakage)
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'e1390000-0000-4000-8000-000000000002', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"e1390000-0000-4000-8000-000000000002"}', true);
  BEGIN
    PERFORM * FROM public.get_merchant_wallet_spendable_breakdown('e1390100-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'foreign user must be denied';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;
  PERFORM pg_temp.check(v_sqlstate = '42501', 'foreign user expected 42501, got ' || v_sqlstate);

  -- Unauthenticated caller is rejected
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    PERFORM * FROM public.get_merchant_wallet_spendable_breakdown('e1390100-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'anon must be denied';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;
  PERFORM pg_temp.check(v_sqlstate = '42501', 'anon expected 42501, got ' || v_sqlstate);

  -- Floor at 0 via GREATEST when exposure exceeds available_balance
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.merchant_wallets
  SET available_balance = 1000
  WHERE merchant_id = 'e1390100-0000-4000-8000-000000000001';

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'e1390000-0000-4000-8000-000000000001', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"e1390000-0000-4000-8000-000000000001"}', true);
  SELECT * INTO v_row
  FROM public.get_merchant_wallet_spendable_breakdown('e1390100-0000-4000-8000-000000000001');
  PERFORM pg_temp.check(v_row.spendable_balance = 0,
    'expected spendable floored at 0, got ' || COALESCE(v_row.spendable_balance::text, '<null>'));
END
$behavioral$;

ROLLBACK;
