-- Minimum-gated manual consume cases, split from the consume file
-- for the 300-line limit. Runs right after it; fixtures carry over.
-- A legacy manual code carrying a positive purchase-minimum snapshot
-- cannot be consumed here (no order amount to verify against): it
-- reports not-found and stays unused, mirroring the redemption RPC.
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, reward_id, points_spent, reward_type,
  reward_value, discount_code, used, expires_at, minimum_order_amount
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'free_shipping',
  NULL, 'RDM-CONSUME7', false, pg_catalog.now() + interval '30 days', 500
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'redemption_not_found'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME7'
   ) AS result)
  AND (SELECT used IS NOT TRUE FROM public.reward_redemptions
   WHERE discount_code = 'RDM-CONSUME7'),
  'minimum-bearing manual code was consumable without an order'
);

-- A pre-snapshot manual code whose reward was deleted (reward_id and
-- minimum both NULL) has an unknowable minimum: it fails closed too.
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, reward_id, points_spent, reward_type,
  reward_value, discount_code, used, expires_at, minimum_order_amount
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'free_shipping',
  NULL, 'RDM-CONSUME8', false, pg_catalog.now() + interval '30 days', NULL
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'redemption_not_found'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME8'
   ) AS result)
  AND (SELECT used IS NOT TRUE FROM public.reward_redemptions
   WHERE discount_code = 'RDM-CONSUME8'),
  'unknown-minimum manual code was consumable without an order'
);

SELECT pg_temp.assert_true(
  (SELECT (result ->> 'success')::boolean
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME6',
     'attempt-key-1'
   ) AS result)
  AND (SELECT (result ->> 'success')::boolean
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME6',
     'attempt-key-1'
   ) AS result),
  'same-key retry did not replay the success receipt'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'already_consumed'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME6',
     'attempt-key-2'
   ) AS result)
  AND (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'already_consumed'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME6'
   ) AS result),
  'different-key or keyless presentation replayed success'
);
