-- Classification helper contracts for the enroll_customer_loyalty suite
-- (migration 20261009235959): the shared predicates every loyalty path
-- now calls, pinned so a future edit cannot quietly re-diverge them.

-- Fulfillable allowlist: exactly the seven types with a path.
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('discount'), 'fulfillable: discount');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('discount_fixed'), 'fulfillable: discount_fixed');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('discount_percentage'), 'fulfillable: discount_percentage');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('store_credit'), 'fulfillable: store_credit');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('free_shipping'), 'fulfillable: free_shipping');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('free_product'), 'fulfillable: free_product');
SELECT pg_temp.assert_true(public.loyalty_reward_type_is_fulfillable('exclusive_access'), 'fulfillable: exclusive_access');
SELECT pg_temp.assert_true(NOT public.loyalty_reward_type_is_fulfillable('gift_card'), 'fulfillable: unknown type allowed');
SELECT pg_temp.assert_true(NOT public.loyalty_reward_type_is_fulfillable(NULL), 'fulfillable: NULL type allowed');

-- Manual classification: present-the-code types, plus valueless plain
-- discounts on the redemption-row variant only.
SELECT pg_temp.assert_true(
  public.loyalty_reward_is_manual_type('free_shipping')
    AND public.loyalty_reward_is_manual_type('free_product')
    AND public.loyalty_reward_is_manual_type('exclusive_access')
    AND NOT public.loyalty_reward_is_manual_type('discount')
    AND public.loyalty_redemption_is_manual('free_product', NULL)
    AND public.loyalty_redemption_is_manual('discount', NULL)
    AND public.loyalty_redemption_is_manual('discount', 0)
    AND NOT public.loyalty_redemption_is_manual('discount', 500)
    AND NOT public.loyalty_redemption_is_manual('store_credit', NULL),
  'manual classification drifted'
);

-- Checkout-bound discounts: fixed/percentage always; plain discount
-- only with a positive value.
SELECT pg_temp.assert_true(
  public.loyalty_reward_is_checkout_discount('discount_fixed', NULL)
    AND public.loyalty_reward_is_checkout_discount('discount_percentage', 150)
    AND public.loyalty_reward_is_checkout_discount('discount', 500)
    AND NOT public.loyalty_reward_is_checkout_discount('discount', NULL)
    AND NOT public.loyalty_reward_is_checkout_discount('discount', 0)
    AND NOT public.loyalty_reward_is_checkout_discount('free_product', 500)
    AND NOT public.loyalty_reward_is_checkout_discount('store_credit', 500),
  'checkout discount classification drifted'
);

-- Valued usability: valued types need a positive value (percentages
-- at most 100); other types are unconstrained.
SELECT pg_temp.assert_true(
  public.loyalty_reward_value_is_usable('discount_percentage', 100)
    AND NOT public.loyalty_reward_value_is_usable('discount_percentage', 101)
    AND NOT public.loyalty_reward_value_is_usable('discount_fixed', NULL)
    AND NOT public.loyalty_reward_value_is_usable('store_credit', 0)
    AND public.loyalty_reward_value_is_usable('discount_fixed', 500)
    AND public.loyalty_reward_value_is_usable('free_product', NULL)
    AND public.loyalty_reward_value_is_usable('discount', NULL),
  'valued usability classification drifted'
);

-- Dead fixed values: fixed-family values rounding to zero units.
SELECT pg_temp.assert_true(
  public.loyalty_reward_fixed_value_is_dead('discount_fixed', 0.10)
    AND public.loyalty_reward_fixed_value_is_dead('discount', 0)
    AND NOT public.loyalty_reward_fixed_value_is_dead('discount', 0.6)
    AND NOT public.loyalty_reward_fixed_value_is_dead('discount', NULL)
    AND NOT public.loyalty_reward_fixed_value_is_dead('discount_percentage', 0),
  'dead fixed value classification drifted'
);

-- Cancellation accepts both spellings and nothing else.
SELECT pg_temp.assert_true(
  public.loyalty_status_is_cancelled('cancelled')
    AND public.loyalty_status_is_cancelled('canceled')
    AND NOT public.loyalty_status_is_cancelled('shipped')
    AND NOT public.loyalty_status_is_cancelled('')
    AND NOT public.loyalty_status_is_cancelled(NULL),
  'cancellation classification drifted'
);

-- Consumers actually call the shared helpers (definition pins, the
-- same technique as the gateway case 34e): an inline copy creeping
-- back into any of these definitions fails here.
SELECT pg_temp.assert_true(
  (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_reward_is_checkout_discount') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'redeem_loyalty_reward')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_reward_value_is_usable') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'redeem_loyalty_reward')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_reward_value_is_usable') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'get_loyalty_status')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_reward_type_is_fulfillable') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'get_loyalty_status')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_redemption_is_manual') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'redeem_loyalty_reward')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_redemption_is_manual') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'get_loyalty_status')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_redemption_is_manual') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'consume_loyalty_redemption')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_status_is_cancelled') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'get_loyalty_redemption_for_checkout')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_reward_is_checkout_discount') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'create_storefront_order_with_loyalty_code')
  AND (SELECT pg_catalog.strpos(
     pg_catalog.pg_get_functiondef(oid),
     'loyalty_status_is_cancelled') > 0
   FROM pg_catalog.pg_proc WHERE proname = 'release_loyalty_claims_on_order_cancel'),
  'a loyalty consumer no longer uses the shared classifiers'
);
