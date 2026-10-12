-- Redemption-idempotency cases (23a-23j): a lost-response retry replays
-- the stored success. Fresh member 024 stays out of every other case
-- (case 20 needs member 018 at exactly 600).
INSERT INTO public.customers (id, merchant_id, email, user_id) VALUES (
  '01aa0000-0000-4000-8000-000000000024',
  '01aa0000-0000-4000-8000-000000000001',
  'idempotent@example.com', '01aa0000-0000-4000-8000-000000000113'
);

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Idempotent perk', 100,
   'discount', true),
  ('01aa0000-0000-4000-8000-000000000001', 'Other perk', 100,
   'discount', true),
  ('01aa0000-0000-4000-8000-000000000001', 'Too pricey', 501,
   'discount', true);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');
SELECT public.enroll_customer_loyalty(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024', NULL);

UPDATE public.customer_loyalty
SET points_balance = 500, lifetime_points = 500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024';

-- 23a. A retry under the same key replays the stored success: same
-- code, no second deduction, a single redemption row.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'keyed first redemption failed'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 400
     AND result ->> 'redemption_code' = (
       SELECT discount_code FROM public.reward_redemptions
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND customer_id = '01aa0000-0000-4000-8000-000000000024'
     )
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result)
  AND (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024')
  AND (SELECT points_balance = 400
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'),
  'same-key retry did not replay without re-spending'
);

-- 23b. The same key with a different reward is a changed intent, not a
-- retry: rejected with no mutation.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'idempotency_key_reused'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Other perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result)
  AND (SELECT points_balance = 400
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'),
  'key reuse with a different reward was not rejected cleanly'
);

-- 23c. A key replayed with mismatched IDs is rejected: ownership
-- passes for the caller's own customer, then the replay guard mismatches.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'idempotency_key_mismatch'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'cross-customer key replay was not rejected'
);

-- 23d. Failures are never stored: an insufficient-points attempt under
-- a key retries as a fresh attempt after a top-up, then replays.
SELECT id AS pricey_reward_id
FROM public.loyalty_rewards
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Too pricey' \gset

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'insufficient_points'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'pricey_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'keyed insufficient-points attempt did not fail cleanly'
);

UPDATE public.customer_loyalty
SET points_balance = 1000
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 499
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'pricey_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'retry after top-up did not succeed fresh under the same key'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 499
     AND result ->> 'redemption_code' = (
       SELECT discount_code FROM public.reward_redemptions
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND customer_id = '01aa0000-0000-4000-8000-000000000024'
         AND reward_id = :'pricey_reward_id'
     )
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'pricey_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result)
  AND (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'
     AND reward_id = :'pricey_reward_id'),
  'post-top-up retry did not store and replay'
);

-- 23e. The idempotency receipt survives its reward row (SET NULL, not
-- cascade), so a lost-response retry replays the stored success
-- instead of failing reward_unavailable. No later case uses it.
SELECT id AS doomed_reward_id
FROM public.loyalty_rewards
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Idempotent perk' \gset

DELETE FROM public.loyalty_rewards WHERE id = :'doomed_reward_id';

SELECT pg_temp.assert_true(
  (SELECT reward_id IS NULL
   FROM public.loyalty_redemption_idempotency_keys
   WHERE key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'reward delete cascaded the idempotency receipt'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 400
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'doomed_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'post-delete retry did not replay the stored success'
);

-- Every idempotency-table FK has a covering index (else deletes scan to enforce cascades).
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_idempotency_keys_merchant_idx'::pg_catalog.regclass
  ) LIKE '%(merchant_id)%'
  AND pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_idempotency_keys_reward_idx'::pg_catalog.regclass
  ) LIKE '%(reward_id)%',
  'idempotency foreign keys lack covering indexes'
);

-- 23f. Ownership precedes replay: another customer's key returns
-- customer_not_found, never the stored code. (Pre-fix this leaked
-- 024's success into 105's session.)
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'customer_not_found'
     AND result ->> 'redemption_code' IS NULL
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'pricey_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'cross-customer replay leaked the stored code'
);

-- 23g. Replay precedes the program-state gate: a receipt replays after
-- a program disable instead of failing program_unavailable. The
-- program is re-enabled immediately: later files need it live.
UPDATE public.loyalty_settings
SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'pricey_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'disabled program blocked the idempotent replay'
);

UPDATE public.loyalty_settings
SET enabled = true
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 23j. RDM trigger grandfathers legacy rows (editable), rejects new RDM writes.
ALTER TABLE public.discount_codes
  DISABLE TRIGGER discount_codes_no_rdm_prefix;
INSERT INTO public.discount_codes (
  merchant_id, code, discount_type, discount_value
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'RDM-LEGACY-01',
  'fixed_amount', 100
);
ALTER TABLE public.discount_codes
  ENABLE TRIGGER discount_codes_no_rdm_prefix;

UPDATE public.discount_codes
SET is_active = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND code = 'RDM-LEGACY-01';

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-LEGACY-01' AND is_active IS NOT TRUE
  ),
  'legacy RDM code was not deactivatable'
);

-- Resending the unchanged code (dashboard/mobile always include it)
-- does not trip the reservation.
UPDATE public.discount_codes SET code = 'RDM-LEGACY-01', is_active = false
WHERE code = 'RDM-LEGACY-01';

DO $$
BEGIN
  UPDATE public.discount_codes
  SET code = 'RDM-LEGACY-02'
  WHERE code = 'RDM-LEGACY-01';
  RAISE EXCEPTION 'RDM code rewrite was not rejected';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- RDM inserts fail too (OLD is NULL there, so the change gate passes).
DO $$
BEGIN
  INSERT INTO public.discount_codes (merchant_id, code, discount_type, discount_value)
  VALUES ('01aa0000-0000-4000-8000-000000000001', 'RDM-NEW-01', 'fixed_amount', 100);
  RAISE EXCEPTION 'RDM code insert was not rejected';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
