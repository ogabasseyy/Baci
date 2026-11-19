-- Fixed public-price tiers reveal bounded eligibility, never a continuous floor.
BEGIN;
\ir product_cost_access.fixture.inc.sql
CREATE FUNCTION pg_temp.assert_negotiation(p_expected numeric)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actual numeric;
BEGIN
  actual := public.get_negotiation_cost_floor_price(
    'ca570000-0000-4000-8000-000000000201',
    'ca570000-0000-4000-8000-000000000101');
  IF actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'negotiation expected %, got %',p_expected,actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_negotiation(numeric) TO anon,authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='public.get_negotiation_cost_floor_price(uuid,uuid)'::regprocedure
      AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC execution must not be inherited';
  END IF;
END $$;
-- Two distinct low costs must produce exactly the same public tier.
UPDATE public.products SET cost_price=8800 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_negotiation(9800);
RESET ROLE;
UPDATE public.products SET cost_price=8900 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(9800);
RESET ROLE;
-- cost*1.1=9823, not returned; fixed 98.5% is the first eligible tier.
UPDATE public.products SET cost_price=8930 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(9850);
RESET ROLE;
UPDATE public.products SET cost_price=8980 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','ca570000-0000-4000-8000-000000000006',true);
SELECT pg_temp.assert_negotiation(9900);
RESET ROLE;
UPDATE public.products SET cost_price=9050 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(10000);
RESET ROLE;
-- Above-list margin never becomes an above-list cost-derived quote.
UPDATE public.products SET cost_price=11000 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(10000);
RESET ROLE;
-- Missing costs preserve the old fallback but still emit a public tier.
UPDATE public.products SET cost_price=NULL WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(9800);
RESET ROLE;
UPDATE public.products SET cost_price=0, price=100.25 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(99); -- ceil(100.25*.98)
DO $$ BEGIN
  IF public.get_negotiation_cost_floor_price(
    'ca570000-0000-4000-8000-000000000202','ca570000-0000-4000-8000-000000000101') IS NOT NULL
    OR public.get_negotiation_cost_floor_price(
    'ca570000-0000-4000-8000-000000000203','ca570000-0000-4000-8000-000000000101') IS NOT NULL
    OR public.get_negotiation_cost_floor_price(
    'ca570000-0000-4000-8000-000000000201','ca570000-0000-4000-8000-000000000102') IS NOT NULL THEN
    RAISE EXCEPTION 'inactive or wrong-merchant product produced a negotiation price';
  END IF;
END $$;
RESET ROLE;
UPDATE public.products SET price=0 WHERE id='ca570000-0000-4000-8000-000000000201';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_negotiation(NULL); -- invalid list price must not authorize an offer
RESET ROLE;
ROLLBACK;
