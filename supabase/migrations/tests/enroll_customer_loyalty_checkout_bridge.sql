-- Checkout-bridge cases for the enroll_customer_loyalty suite (cases
-- 24a-25c). Runs after idempotency: discount-typed RDM-* codes resolve
-- for checkout and the order wrapper claims them atomically. Member 024
-- (balance 499 after case 23d) funds the fixture redemptions; case 20's
-- member-018 balance is untouched. Grant asserts live here instead of
-- setup (repository 300-line limit).
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

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  (SELECT id FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Bridge fixed'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  (SELECT id FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Bridge percent'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  (SELECT id FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Bridge credit'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');

-- 24a. A discount-typed code resolves with its snapshot terms plus the
-- live minimum and reward state.
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'discount_fixed'
     AND row.reward_value = 1000
     AND row.minimum_order_amount = 5000
     AND row.reward_enabled IS TRUE
     AND row.used IS FALSE
     AND row.reward_name = 'Bridge fixed'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     (SELECT discount_code FROM public.reward_redemptions
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND customer_id = '01aa0000-0000-4000-8000-000000000024'
        AND reward_id = (
          SELECT id FROM public.loyalty_rewards
          WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
            AND name = 'Bridge fixed'
        ))
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
     lower((SELECT discount_code FROM public.reward_redemptions
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND customer_id = '01aa0000-0000-4000-8000-000000000024'
        AND reward_id = (
          SELECT id FROM public.loyalty_rewards
          WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
            AND name = 'Bridge percent'
        )))
   )),
  'lowercase loyalty code did not resolve'
);

-- 24d. Non-discount types resolve too: the resolve is dumb and the
-- routes/wrapper filter (single enforcement point per layer).
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'store_credit'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     (SELECT discount_code FROM public.reward_redemptions
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND customer_id = '01aa0000-0000-4000-8000-000000000024'
        AND reward_id = (
          SELECT id FROM public.loyalty_rewards
          WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
            AND name = 'Bridge credit'
        ))
   ) AS row),
  'store_credit code did not resolve for layer filtering'
);

-- 24e. Used codes still resolve with used=true (enforcement lives in
-- the wrapper, which re-locks and re-verifies).
UPDATE public.reward_redemptions
SET used = true, used_at = pg_catalog.now()
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024'
  AND reward_id = (
    SELECT id FROM public.loyalty_rewards
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND name = 'Bridge percent'
  );

SELECT pg_temp.assert_true(
  (SELECT row.used IS TRUE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     (SELECT discount_code FROM public.reward_redemptions
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND customer_id = '01aa0000-0000-4000-8000-000000000024'
        AND reward_id = (
          SELECT id FROM public.loyalty_rewards
          WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
            AND name = 'Bridge percent'
        ))
   ) AS row),
  'used loyalty code did not resolve with used=true'
);

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

-- 25c. The wrapper's claim mechanics are pinned on the definition (the
-- full order flow needs the orders schema, which the stub suite does
-- not model; runtime coverage comes from the local bridge probe plus
-- the route tests): row lock, used-marking, minimum, two-sided amount
-- check, and the replay-first branch.
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
  ) LIKE '%idempotency_replayed%',
  'loyalty order wrapper is missing claim mechanics'
);

-- Bridge grants: both functions are self-policing bearer endpoints
-- (mirroring the discount-code functions), so anon through
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

-- The checkout lookup index normalizes case like the resolver and is
-- merchant-scoped unique: a plain (merchant_id, discount_code) index
-- could serve only the merchant prefix, and without uniqueness the
-- resolver's LIMIT 1 could straddle two same-code redemptions.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_checkout_code_idx'::pg_catalog.regclass
  ) LIKE 'CREATE UNIQUE INDEX%upper(%discount_code%)%',
  'checkout code index is not unique or does not normalize case'
);

-- A duplicate code (even in another case) is rejected, so checkout can
-- never resolve the wrong redemption.
DO $dup$
BEGIN
  INSERT INTO public.reward_redemptions (
    merchant_id, customer_id, reward_id, points_spent,
    reward_type, discount_code
  ) VALUES (
    '01aa0000-0000-4000-8000-000000000001',
    '01aa0000-0000-4000-8000-000000000024',
    (SELECT id FROM public.loyalty_rewards
     WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
       AND name = 'Bridge percent'),
    100, 'discount_percentage',
    lower((SELECT discount_code FROM public.reward_redemptions
     WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
       AND customer_id = '01aa0000-0000-4000-8000-000000000024'
       AND reward_id = (
         SELECT id FROM public.loyalty_rewards
         WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
           AND name = 'Bridge fixed')))
  );
  RAISE EXCEPTION 'duplicate redemption code was accepted';
EXCEPTION WHEN unique_violation THEN
  -- Expected: the unique code index rejected the duplicate.
END;
$dup$;

-- The redeem RPC retries code generation on that constraint (probe +
-- insert-retry like the referral path) instead of surfacing a 500.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.redeem_loyalty_reward(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) LIKE '%redemption_code_collision%'
  AND pg_catalog.pg_get_functiondef(
    'public.redeem_loyalty_reward(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) LIKE '%EXCEPTION WHEN unique_violation%',
  'redeem does not retry code collisions'
);

-- The order wrapper locks the reward policy row and re-reads it: FOR
-- UPDATE OF rr cannot cover the nullable side of the redemption join,
-- so without this a merchant disabling the reward mid-checkout would
-- race validation with stale enabled/minimum values.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure
  ) LIKE '%FROM public.loyalty_rewards rw%WHERE rw.id = v_redemption.reward_id%FOR UPDATE%',
  'order wrapper does not lock the reward policy row'
);
