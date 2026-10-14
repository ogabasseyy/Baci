-- Shared loyalty reward/order classification predicates (issue #3165).
--
-- The enrollment, status, redemption, checkout-bridge, and consume
-- paths each re-implemented these type/value/status tests inline, and
-- the copies drifted (a cap gate that also caught manual rewards, a
-- catalog that advertised rewards the RPC rejects). They live here,
-- before every consumer in the series, so each rule exists once.
-- All helpers are IMMUTABLE and total: NULL inputs classify as
-- not-matching rather than erroring.

-- A reward type with any fulfillment path (checkout, wallet, or
-- present-the-code). Anything else is unredeemable.
CREATE OR REPLACE FUNCTION public.loyalty_reward_type_is_fulfillable(
  p_reward_type text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_reward_type IN (
    'discount', 'discount_fixed', 'discount_percentage',
    'store_credit', 'free_shipping', 'free_product', 'exclusive_access'
  ), false)
$$;

-- Present-the-code types: fulfilled in person, never at checkout.
CREATE OR REPLACE FUNCTION public.loyalty_reward_is_manual_type(
  p_reward_type text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_reward_type IN (
    'free_shipping', 'free_product', 'exclusive_access'
  ), false)
$$;

-- A manual-fulfillment redemption row: a present-the-code type, or a
-- valueless plain discount (staff decide the benefit at presentation).
CREATE OR REPLACE FUNCTION public.loyalty_redemption_is_manual(
  p_reward_type text,
  p_reward_value numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.loyalty_reward_is_manual_type(p_reward_type)
    OR (p_reward_type = 'discount' AND COALESCE(p_reward_value, 0) <= 0)
$$;

-- A checkout-bound discount: fixed/percentage types, or a plain
-- discount carrying a positive value. Everything else is honored
-- off-checkout.
CREATE OR REPLACE FUNCTION public.loyalty_reward_is_checkout_discount(
  p_reward_type text,
  p_reward_value numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_reward_type IN ('discount_fixed', 'discount_percentage'), false)
    OR (p_reward_type = 'discount' AND COALESCE(p_reward_value, 0) > 0)
$$;

-- Valued types (wallet credit, fixed, percentage) are usable only
-- with a positive value, percentages at most 100. Other types are
-- unconstrained by this rule.
CREATE OR REPLACE FUNCTION public.loyalty_reward_value_is_usable(
  p_reward_type text,
  p_reward_value numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_reward_type NOT IN (
      'store_credit', 'discount_fixed', 'discount_percentage'
    ), false)
    OR (COALESCE(p_reward_value, 0) > 0
      AND (p_reward_type <> 'discount_percentage' OR p_reward_value <= 100))
$$;

-- A fixed-family value that rounds to zero currency units: minting
-- or advertising it would promise a discount worth nothing.
CREATE OR REPLACE FUNCTION public.loyalty_reward_fixed_value_is_dead(
  p_reward_type text,
  p_reward_value numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_reward_type IN ('discount', 'discount_fixed'), false)
    AND p_reward_value IS NOT NULL
    AND pg_catalog.round(p_reward_value) <= 0
$$;

-- Effective cancellation of an order status field: the platform has
-- written both spellings ('cancelled' via cancel paths, 'canceled'
-- via US-spelled writers), and terminal handling accepts either.
CREATE OR REPLACE FUNCTION public.loyalty_status_is_cancelled(
  p_status text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_status, '') IN ('cancelled', 'canceled')
$$;

REVOKE ALL ON FUNCTION public.loyalty_reward_type_is_fulfillable(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_reward_is_manual_type(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_redemption_is_manual(text, numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_reward_is_checkout_discount(text, numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_reward_value_is_usable(text, numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_reward_fixed_value_is_dead(text, numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loyalty_status_is_cancelled(text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.loyalty_reward_type_is_fulfillable(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_reward_is_manual_type(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_redemption_is_manual(text, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_reward_is_checkout_discount(text, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_reward_value_is_usable(text, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_reward_fixed_value_is_dead(text, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_status_is_cancelled(text)
  TO authenticated, service_role;
