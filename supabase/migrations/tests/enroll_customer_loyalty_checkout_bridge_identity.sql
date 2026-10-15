-- Issued-code identity cases (24i) plus the wrapper definition pins
-- (25c onward), split from the bridge file for the 300-line limit.
-- Runs right after it against the same fixtures.
-- 24i. Issued-code identity is the issuance snapshot: renaming the
-- reward afterwards does not change what checkout presents.
UPDATE public.loyalty_rewards SET name = 'Renamed bridge reward'
WHERE id = :'fixed_reward_id';
SELECT pg_temp.assert_true(
  (SELECT row.reward_name = 'Bridge fixed'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'fixed_code'
   ) AS row),
  'checkout lookup followed a post-issuance reward rename'
);
UPDATE public.loyalty_rewards SET name = 'Bridge fixed'
WHERE id = :'fixed_reward_id';

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
