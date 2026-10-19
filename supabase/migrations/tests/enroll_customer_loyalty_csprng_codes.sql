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
      AND p.prosrc NOT LIKE '%md5%'
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
