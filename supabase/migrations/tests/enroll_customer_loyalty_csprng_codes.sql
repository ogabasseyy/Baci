-- CSPRNG loyalty code minting (migration 20261010000027): the four
-- minting functions now source referral and redemption codes from
-- extensions.gen_random_bytes instead of MD5(random() || timestamp),
-- keeping the same code shapes the checkout resolver accepts.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'enroll_customer_loyalty',
        'award_purchase_points',
        'adjust_loyalty_points',
        'redeem_loyalty_reward'
      )
      AND p.prosrc LIKE '%gen_random_bytes%'
      AND p.prosrc NOT ILIKE '%md5(%'
      AND p.prosrc NOT ILIKE '%random()%'
  ) = 4,
  'csprng mint clause failed'
);

-- A fresh member mints a referral code through enroll (8 uppercase
-- hex). Scoped to this part's own rows: earlier suites deliberately
-- fixture legacy-shaped codes.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  '01aa0000-0000-4000-8000-000000000181',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'enroll-user-81@example.com',
  'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}', '{}'
);
INSERT INTO public.customers (id, merchant_id, email, user_id) VALUES (
  '01aa0000-0000-4000-8000-000000000081',
  '01aa0000-0000-4000-8000-000000000001',
  'enroll-81@example.com',
  '01aa0000-0000-4000-8000-000000000181'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000181');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000081',
     NULL
   ) AS result),
  'csprng enroll clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.customer_loyalty
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND customer_id = '01aa0000-0000-4000-8000-000000000081'
      AND referral_code ~ '^[0-9A-F]{8}$'
  ),
  'referral code shape clause failed'
);

-- Top the member up as the merchant owner (staff fixtures from the
-- adjustment suite), then redeem: the minted redemption code keeps
-- the RDM- + 12 uppercase hex shape.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000081',
     1000, 'CSPRNG top-up', 'adjust'
   ) AS result),
  'csprng top-up clause failed'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000181');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'redemption_code') ~ '^RDM-[0-9A-F]{12}$'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000081',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'redemption code shape clause failed'
);

-- The adjust and award creation paths mint referral codes too (the
-- top-up above ran on an already-enrolled member, so its creation
-- loop never fired). Exercise both on first-touch members.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES (
  '01aa0000-0000-4000-8000-000000000182',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'enroll-user-82@example.com',
  'test', pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}', '{}'
);
INSERT INTO public.customers (id, merchant_id, email, user_id) VALUES (
  '01aa0000-0000-4000-8000-000000000082',
  '01aa0000-0000-4000-8000-000000000001',
  'enroll-82@example.com',
  '01aa0000-0000-4000-8000-000000000182'
), (
  '01aa0000-0000-4000-8000-000000000083',
  '01aa0000-0000-4000-8000-000000000001',
  'enroll-83@example.com',
  NULL
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000082',
     100, 'CSPRNG first adjust', 'adjust'
   ) AS result),
  'csprng first-adjust clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.customer_loyalty
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND customer_id = '01aa0000-0000-4000-8000-000000000082'
      AND referral_code ~ '^[0-9A-F]{8}$'
  ),
  'adjust-minted referral code shape clause failed'
);

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '01aa0000-0000-4000-8000-000000000083',
    '01aa0000-0000-4000-8000-000000000001',
    '01aa0000-0000-4000-8000-0000000000a3',
    10000
  ) > 0,
  'csprng first-award clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.customer_loyalty
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND customer_id = '01aa0000-0000-4000-8000-000000000083'
      AND referral_code ~ '^[0-9A-F]{8}$'
  ),
  'award-minted referral code shape clause failed'
);

-- Permission boundary: pg_temp.as_user only sets JWT claims, never the
-- session role, so every call above runs as the migration owner and
-- cannot catch a missing privilege on the mint path. The invoker-rights
-- award mints through public.loyalty_gen_random_bytes, so executing the
-- wrapper as a real authenticated session pins the EXECUTE grant plus
-- the definer chain (dropping either fails here with permission
-- denied) without depending on table RLS. SET LOCAL scopes the switch
-- to this transaction; RESET ROLE restores the owner afterwards.
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  pg_catalog.length(public.loyalty_gen_random_bytes(4)) = 4,
  'csprng wrapper clause failed for authenticated role'
);
RESET ROLE;
