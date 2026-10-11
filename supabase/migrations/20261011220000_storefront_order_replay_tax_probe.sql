-- Narrowly scoped replay-economics projection for checkout validation.
--
-- Companion to has_storefront_order_idempotency_key: on a confirmed
-- idempotent retry past a changed offer, the orders route must reuse the
-- stored order's tax_amount. Recomputing VAT from parent prices would drift
-- tax_amount, change the request hash, and turn the retry into an
-- idempotency conflict instead of replaying it.
--
-- Returns only the stored tax (or NULL when no keyed order exists) through
-- the caller's normal (anon/authenticated) client, so the user-facing
-- route never needs a service-role orders read. No other order fields
-- cross the API boundary.
CREATE OR REPLACE FUNCTION public.get_storefront_order_replay_tax(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.tax_amount
  FROM public.orders AS o
  WHERE p_merchant_id IS NOT NULL
    AND p_checkout_idempotency_key IS NOT NULL
    AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
    AND o.merchant_id = p_merchant_id
    AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_storefront_order_replay_tax(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_order_replay_tax(uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_storefront_order_replay_tax(uuid, text) IS
  'Returns only the stored tax_amount for a merchant-scoped checkout idempotency key, for guest-safe idempotent replay past changed offers. No other order fields are exposed.';
