-- Status projection and cap cases for the enroll_customer_loyalty suite
-- (cases 27-28). Runs last: case 28 depends on the case-19 usage cap,
-- and case 27 mutates member 011 balances no later case depends on.

-- 27. Status projects the spendable balance without writing: member 011
-- holds 300 materialized with a 200-point expired lot and no redemption
-- yet, so status reports 100 while the row and the lot stay untouched.
UPDATE public.customer_loyalty
SET points_balance = 300, lifetime_points = 300
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000011';

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, expires_at, created_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000011',
  '01aa0000-0000-4000-8000-000000000001',
  'earn', 200, 300, 'purchase', 'Old purchase',
  now() - interval '1 day', now() - interval '3 days'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 100
     AND (result ->> 'lifetime_points')::integer = 300
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Big perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'status advertised the unreconciled balance'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 300
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011')
  AND (SELECT expired IS NOT TRUE
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'
     AND type = 'earn'
     AND points = 200),
  'status projection wrote through to the ledger'
);

-- 28. Status hides rewards the caller exhausted: member 012 redeemed the
-- limit-1 One-time perk in case 19, so it disappears from 012's catalog
-- (but stays for unenrolled 016 — the cap binds per customer).
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'One-time perk'
     )
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Free shipping'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012'
   ) AS result),
  'status re-advertised a capped reward'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000106');

SELECT pg_temp.assert_true(
  (SELECT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'One-time perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016'
   ) AS result),
  'uncapped customer lost sight of a capped reward'
);
