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

ROLLBACK;
