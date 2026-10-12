-- Purchase-award cases for the enroll_customer_loyalty suite (cases
-- 5d-5f). Split out of the enrollment part (repository 300-line limit);
-- the 02aa fixtures below are fully isolated from merchant 1.

-- 5d. Purchase awards coalesce NULL balances: legacy member rows predate
-- the DEFAULT 0 backfill, and without COALESCE the NULL propagates into
-- the UPDATE and the NOT NULL balance_after ledger, aborting checkout.
-- (Isolated second merchant: earning-config mutations must not leak into
-- the referral/status cases below.)
SET LOCAL ROLE service_role;
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '02aa0000-0000-4000-8000-000000000001',
  'loyalty-award-merchant@example.com',
  'Loyalty Award Merchant',
  'loyalty-award-merchant'
);
RESET ROLE;

INSERT INTO public.customers (id, merchant_id, email)
VALUES (
  '02aa0000-0000-4000-8000-000000000011',
  '02aa0000-0000-4000-8000-000000000001',
  'award-a@example.com'
);

INSERT INTO public.loyalty_settings (
  merchant_id, enabled, points_currency_unit, points_per_currency,
  points_expiry_days
) VALUES (
  '02aa0000-0000-4000-8000-000000000001', true, 100, 1, 30
);

INSERT INTO public.customer_loyalty (
  merchant_id, customer_id, points_balance, lifetime_points, current_tier
) VALUES (
  '02aa0000-0000-4000-8000-000000000001',
  '02aa0000-0000-4000-8000-000000000011',
  NULL, NULL, 'Bronze'
);

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a1',
    250
  ) = 2,
  'award on NULL balances returned the wrong points'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 2 AND lifetime_points = 2
   FROM public.customer_loyalty
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011')
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011'
     AND type = 'earn'
     AND points = 2
     AND balance_after = 2),
  'award on NULL balances wrote NULLs or skipped the ledger'
);

-- 5e. NULL or zero earning divisors award 0 instead of erroring: NULL
-- points would slip past the <= 0 check and a zero divisor raises
-- division-by-zero, failing checkout.
UPDATE public.loyalty_settings
SET points_currency_unit = 0
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a2',
    250
  ) = 0,
  'zero divisor did not award 0'
);

UPDATE public.loyalty_settings
SET points_currency_unit = NULL
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a3',
    250
  ) = 0,
  'NULL divisor did not award 0'
);

-- 5f. First-purchase enrollment retries referral-code collisions like the
-- enrollment RPC: a blindly generated code can hit the case-insensitive
-- unique index and must not lose the award. (Forcing a real RNG collision
-- deterministically is infeasible in one session; pin the retry loop on
-- the function definition like the creation-lock assertions do.)
SELECT pg_temp.assert_true(
  pg_get_functiondef(
    'public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure
  ) LIKE '%EXCEPTION WHEN unique_violation%'
  AND pg_get_functiondef(
    'public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure
  ) LIKE '%v_attempt >= 5%',
  'award_purchase_points does not retry referral-code collisions'
);

-- 10c. The manual adjustment writer shares the same advisory creation
-- lock as enrollment and purchase awards (same hashtext key), so the
-- three writers serialize instead of double-inserting; it also takes
-- the member-row lock before its read-modify-write. (See case 10 for
-- why two live sessions cannot run inside this harness; the interleaved
-- proof lives in enroll_customer_loyalty_concurrency.sql, in-gate.)
SELECT pg_temp.assert_true(
  position(
    'pg_catalog.hashtext(p_merchant_id::text || '':'' || p_customer_id::text)'
    IN pg_catalog.pg_get_functiondef(
      'public.adjust_loyalty_points(uuid,uuid,integer,text,text)'::pg_catalog.regprocedure
    )
  ) > 0,
  'manual adjustments lost the shared creation lock'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.adjust_loyalty_points(uuid,uuid,integer,text,text)'::pg_catalog.regprocedure
  ) LIKE '%FOR UPDATE%',
  'manual adjustments lost the member-row lock'
);

-- 5g. Malformed tier containers (object/scalar: the settings field
-- persists without schema validation) fall back to Bronze instead of
-- raising inside jsonb_array_elements and failing the award. (Case 5e
-- leaves the currency divisor NULL, so restore it here.)
UPDATE public.loyalty_settings
SET tiers = '{"Silver": 100}'::jsonb, points_currency_unit = 100
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a4',
    10000
  ) = 100
  AND (SELECT current_tier = 'Bronze'
   FROM public.customer_loyalty
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011'),
  'object tier container broke the purchase award'
);

SELECT pg_temp.assert_true(
  (SELECT current_tier = 'Bronze'
   FROM public.customer_loyalty
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011'),
  'DBG object tiers: tier half failed'
);

UPDATE public.loyalty_settings
SET tiers = '"just-a-string"'::jsonb
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.calculate_loyalty_tier(
    5000, '02aa0000-0000-4000-8000-000000000001'
  ) = 'Bronze',
  'scalar tier container did not fall back to Bronze'
);

UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';
