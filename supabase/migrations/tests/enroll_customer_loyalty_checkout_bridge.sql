-- Checkout-bridge cases (24a-25c): discount RDM-* codes resolve and
-- the order wrapper claims them atomically. Member 024 funds fixtures.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge fixed', 100,
   'discount_fixed', 1000, 5000, true),
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge percent', 100,
   'discount_percentage', 10, NULL, true),
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge credit', 100,
   'store_credit', 500, NULL, true);

SELECT id AS fixed_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge fixed' \gset
SELECT id AS percent_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge percent' \gset
SELECT id AS credit_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge credit' \gset

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'fixed_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'percent_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'credit_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');

SELECT discount_code AS fixed_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'fixed_reward_id' \gset
SELECT discount_code AS percent_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'percent_reward_id' \gset
SELECT discount_code AS credit_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'credit_reward_id' \gset

-- 24a. A discount-typed code resolves with its snapshot terms.
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'discount_fixed'
     AND row.reward_value = 1000
     AND row.minimum_order_amount = 5000
     AND row.used IS FALSE
     AND row.issuance_currency = 'NGN'
     AND row.max_redemption_percentage = 50
     AND row.reward_name = 'Bridge fixed'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'fixed_code'
   ) AS row),
  'discount-typed loyalty code did not resolve with terms'
);

-- 24b. Unknown codes resolve to no row (the routes answer invalid).
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.get_loyalty_redemption_for_checkout(
      '01aa0000-0000-4000-8000-000000000001', 'RDM-NOPE'
    )
  ),
  'unknown code resolved a loyalty row'
);

-- 24c. Matching is case-insensitive like the discount-code resolve.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     lower(:'percent_code')
   )),
  'lowercase loyalty code did not resolve'
);

-- 24d. Non-discount types resolve too (routes/wrapper filter).
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'store_credit'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'credit_code'
   ) AS row),
  'store_credit code did not resolve for layer filtering'
);

-- 24e. Used codes still resolve with used=true (wrapper enforces).
UPDATE public.reward_redemptions
SET used = true, used_at = pg_catalog.now()
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024'
  AND reward_id = :'percent_reward_id';

SELECT pg_temp.assert_true(
  (SELECT row.used IS TRUE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'percent_code'
   ) AS row),
  'used loyalty code did not resolve with used=true'
);

-- 24f. A disabled reward does not void its issued codes.
UPDATE public.loyalty_rewards SET enabled = false
WHERE id = :'fixed_reward_id';

SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'discount_fixed'
     AND row.reward_value = 1000
     AND row.minimum_order_amount = 5000
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'fixed_code'
   ) AS row),
  'disabled reward voided its issued code'
);

UPDATE public.loyalty_rewards SET enabled = true
WHERE id = :'fixed_reward_id';

-- 24g. A no-minimum mint survives a later merchant minimum.
UPDATE public.loyalty_rewards SET minimum_order_amount = 5000
WHERE id = :'percent_reward_id';
SELECT pg_temp.assert_true(
  (SELECT row.minimum_order_amount = 0
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'percent_code'
   ) AS row),
  'no-minimum code inherited the raised live minimum'
);
UPDATE public.loyalty_rewards SET minimum_order_amount = NULL
WHERE id = :'percent_reward_id';

-- 24h. The issuance stamp freezes at mint (a payout flip cannot move it).
UPDATE public.merchants SET payout_currency = 'USD' WHERE id = '01aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT public.merchant_resolved_currency('01aa0000-0000-4000-8000-000000000001') = 'USD')
  AND (SELECT row.issuance_currency = 'NGN' FROM public.get_loyalty_redemption_for_checkout('01aa0000-0000-4000-8000-000000000001', :'fixed_code') AS row),
  'issuance currency moved after a payout currency flip');
UPDATE public.merchants SET payout_currency = 'NGN' WHERE id = '01aa0000-0000-4000-8000-000000000001';

-- 25a. The order wrapper rejects a NULL redemption id before touching
-- the order RPC.
DO $$
BEGIN
  PERFORM public.create_storefront_order_with_loyalty_code(
    '01aa0000-0000-4000-8000-000000000001', 'bridge@example.com',
    'Bridge Shopper', '[]'::jsonb
  );
  RAISE EXCEPTION 'null redemption id did not raise';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%loyalty_redemption_required%' THEN
      RAISE EXCEPTION 'wrong error for null redemption id: %', SQLERRM;
    END IF;
END $$;

-- 25b. The order wrapper rejects an unknown redemption id before
-- touching the order RPC.
DO $$
BEGIN
  PERFORM public.create_storefront_order_with_loyalty_code(
    '01aa0000-0000-4000-8000-000000000001', 'bridge@example.com',
    'Bridge Shopper', '[]'::jsonb,
    NULL, 0, 0, 0, 'card', 'unpaid', 'pending', NULL, 'online_store',
    NULL, NULL, NULL, NULL, NULL, NULL, 'exclusive', 0, NULL, NULL,
    NULL, '01aa0000-0000-4000-8000-000000000099'
  );
  RAISE EXCEPTION 'unknown redemption id did not raise';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%loyalty_redemption_not_found%' THEN
      RAISE EXCEPTION 'wrong error for unknown redemption id: %', SQLERRM;
    END IF;
END $$;

-- 25c. Wrapper claim mechanics pinned on the definition (the stub
-- suite cannot model full orders): lock, used-marking, minimum,
-- amount check, replay-first, parent-before-child lock order.
SELECT pg_temp.assert_true(
  pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%FOR UPDATE%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%SET used = true, used_on_order_id = v_order.id%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%minimum_order_amount%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%discount_amount_mismatch%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%loyalty_code_currency_mismatch%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%max_redemption_percentage%'
  AND pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
  ) LIKE '%idempotency_replayed%'
  -- Parent lock precedes the child lock (reversed order deadlocks
  -- against the rewards DELETE route's parent-first FK cascade), and
  -- no live-enabled gate strands paid codes (snapshot governance).
  AND (
    SELECT strpos(def, 'FROM public.loyalty_rewards rw') > 0
       AND strpos(def, 'FROM public.loyalty_rewards rw')
         < strpos(def, 'FOR UPDATE OF rr')
       AND strpos(def, 'loyalty_reward_inactive') = 0
    FROM pg_get_functiondef(
      'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
    ) AS def
  ),
  'loyalty order wrapper is missing claim mechanics'
);

-- Bridge grants: self-policing Bearer [REDACTED]; anon through
-- service_role hold EXECUTE and PUBLIC holds nothing.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.get_loyalty_redemption_for_checkout(uuid,text)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND has_function_privilege('anon',
    'public.get_loyalty_redemption_for_checkout(uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.get_loyalty_redemption_for_checkout(uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.get_loyalty_redemption_for_checkout(uuid,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND has_function_privilege('anon',
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)', 'EXECUTE'),
  'loyalty checkout bridge grants are incorrect'
);

-- The lookup index normalizes case and is merchant-scoped unique.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_checkout_code_idx'::pg_catalog.regclass
  ) LIKE 'CREATE UNIQUE INDEX%upper(%discount_code%)%',
  'checkout code index is not unique or does not normalize case'
);

-- A duplicate code (even in another case) is rejected. Staged
-- through a temp table: psql variables skip DO blocks.
CREATE TEMP TABLE probe_dup AS
SELECT :'percent_reward_id'::uuid AS reward_id, :'fixed_code'::text AS code;
DO $dup$
BEGIN
  INSERT INTO public.reward_redemptions (
    merchant_id, customer_id, reward_id, points_spent,
    reward_type, discount_code
  )
  SELECT '01aa0000-0000-4000-8000-000000000001',
    '01aa0000-0000-4000-8000-000000000024',
    reward_id, 100, 'discount_percentage', lower(code)
  FROM probe_dup;
  RAISE EXCEPTION 'duplicate redemption code was accepted';
EXCEPTION WHEN unique_violation THEN
  -- Expected: the unique code index rejected the duplicate.
END;
$dup$;

-- The redeem RPC retries code generation on that constraint instead of a 500.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.redeem_loyalty_reward(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) LIKE '%redemption_code_collision%'
  AND pg_catalog.pg_get_functiondef(
    'public.redeem_loyalty_reward(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) LIKE '%EXCEPTION WHEN unique_violation%',
  'redeem does not retry code collisions'
);

-- The order wrapper locks parent-before-child (reward, then FOR
-- UPDATE OF rr); inverting deadlocks against the DELETE route.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure
  ) LIKE '%FROM public.loyalty_rewards rw%WHERE rw.id = v_reward_id FOR UPDATE%FOR UPDATE OF rr%',
  'order wrapper does not lock parent-before-child'
);
