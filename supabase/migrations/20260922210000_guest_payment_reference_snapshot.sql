-- Proof-bound guest verification snapshot (enumeration-safe).
--
-- Extends the verify_payment_reference_token pattern: a SECURITY DEFINER
-- function so the unauthenticated verify route can serve a sessionless
-- guest WITHOUT a service-role table client in a user-facing route. Access
-- control lives in the WHERE clause: the caller must supply the exact
-- gateway reference AND the matching order tracking token, and only an
-- order-bound transaction row is ever returned. An unknown reference, a
-- token mismatch, a non-order transaction, an order without a tracking
-- token, and empty inputs all return zero rows, so a valid reference
-- cannot be distinguished from a bogus one without also knowing the
-- order's tracking token (no existence oracle).
--
-- The guest path is read-only: it verifies against the provider and
-- reports locally-finalized state, but payment-finalization writes stay
-- on the gateway webhook / service boundary. Used by
-- POST /api/payments/verify for sessionless checkouts.

CREATE OR REPLACE FUNCTION public.get_guest_payment_reference_snapshot(
  p_gateway_reference text,
  p_tracking_token text
)
RETURNS TABLE (
  transaction_id uuid,
  order_id uuid,
  merchant_id uuid,
  amount numeric,
  currency text,
  transaction_status text,
  gateway text,
  gateway_reference text,
  gateway_response jsonb,
  metadata jsonb,
  platform_fee numeric,
  order_number text,
  order_payment_status text,
  order_shipping_status text,
  order_total numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT t.id,
         t.order_id,
         t.merchant_id,
         t.amount,
         t.currency,
         t.status,
         t.gateway,
         t.gateway_reference,
         t.gateway_response,
         t.metadata,
         t.platform_fee,
         o.order_number,
         o.payment_status,
         o.shipping_status,
         o.total
    FROM public.transactions AS t
    JOIN public.orders AS o ON o.id = t.order_id
   WHERE t.gateway_reference = p_gateway_reference
     AND o.tracking_token IS NOT NULL
     AND o.tracking_token <> ''
     AND o.tracking_token = p_tracking_token;
$$;

COMMENT ON FUNCTION public.get_guest_payment_reference_snapshot(text, text) IS
  'Proof-bound guest read model for payment reference verification: returns the reference transaction plus its order only when the gateway reference belongs to an order carrying the supplied tracking token. Used by POST /api/payments/verify for sessionless checkouts (read-only; finalization stays on the webhook boundary).';

REVOKE ALL ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  TO anon, authenticated, service_role;
