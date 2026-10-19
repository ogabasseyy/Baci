-- Cancelled-replay pre-check pin (25d), split from the bridge file
-- for the 300-line limit. Runs right after it; definition-only.
-- 25d. Cancelled replays are rejected before the base RPC runs:
-- the RPC reopens payment-only cancellations (resetting them to
-- unpaid), so a post-call check would observe an already-reopened
-- order. The pre-check must precede the mutating call in the body.
SELECT pg_temp.assert_true(
  (SELECT strpos(def, 'order_not_reusable') > 0
     AND strpos(def, 'order_not_reusable')
       < strpos(def, 'public.create_storefront_order(')
   FROM pg_catalog.pg_get_functiondef(
     'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure
   ) AS def),
  'order wrapper does not reject cancelled replays before the base RPC'
);

-- 25e. An unknowable minimum snapshot fails closed: when the reward
-- was deleted before the backfill, the post-COALESCE minimum stays
-- null with no live fallback, and the wrapper must refuse rather
-- than silently dropping the purchase minimum.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure
  ) LIKE '%v_redemption.minimum_order_amount IS NULL%v_redemption.reward_id IS NULL%',
  'order wrapper accepts redemptions whose minimum is unknowable'
);
