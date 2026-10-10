-- Status cases for the enroll_customer_loyalty suite (cases 10-12).

-- 10. Status fail-closes on program/customer/ownership.
UPDATE public.loyalty_settings
SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'program_unavailable'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'status did not fail closed on a disabled program'
);

UPDATE public.loyalty_settings
SET enabled = true
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000099'
   ) AS result),
  'status did not fail closed on an unknown customer'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'cross-customer status disclosed membership'
);

-- 11. A non-enrolled customer gets zeros plus the live catalog.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000106');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'enrolled')::boolean IS FALSE
     AND (result ->> 'points_balance')::integer = 0
     AND (result ->> 'lifetime_points')::integer = 0
     AND result ->> 'current_tier' = 'Bronze'
     AND jsonb_array_length(result -> 'rewards') = 1
     AND result -> 'rewards' -> 0 ->> 'name' = 'Free shipping'
     AND (result -> 'rewards' -> 0 ->> 'points_cost')::integer = 200
     AND jsonb_array_length(result -> 'transactions') = 0
     AND jsonb_array_length(result -> 'tiers') = 4
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016'
   ) AS result),
  'non-enrolled status returned the wrong projection'
);

-- 12. An enrolled customer gets balances, catalog, and recent transactions.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'enrolled')::boolean IS TRUE
     AND (result ->> 'points_balance')::integer = 100
     AND (result ->> 'lifetime_points')::integer = 100
     AND result ->> 'current_tier' = 'Bronze'
     AND jsonb_array_length(result -> 'rewards') = 1
     AND jsonb_array_length(result -> 'transactions') = 2
     AND (SELECT count(*)
       FROM jsonb_array_elements(result -> 'transactions')
       WHERE value ->> 'type' = 'referral') = 1
     AND (SELECT count(*)
       FROM jsonb_array_elements(result -> 'transactions')
       WHERE value ->> 'type' = 'bonus') = 1
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'enrolled status returned the wrong projection'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND result ->> 'current_tier' = 'Silver'
     AND (result ->> 'lifetime_points')::integer = 1500
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015'
   ) AS result),
  'tier-crossing status returned the wrong tier'
);
