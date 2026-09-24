-- Guest reference-verification proof binding (enumeration-safe).
--
-- Mirrors get_repair_status: a SECURITY DEFINER function so the
-- unauthenticated verify route can authorize a sessionless guest WITHOUT a
-- service-role table client in a user-facing route. Access control lives in
-- the WHERE clause: the caller must supply the exact gateway reference AND
-- the matching order tracking token. An unknown reference, a token
-- mismatch, an order without a tracking token, and empty inputs all return
-- false, so a valid reference cannot be confirmed without also knowing the
-- order's tracking token (no existence oracle).

CREATE OR REPLACE FUNCTION public.verify_payment_reference_token(
  p_gateway_reference text,
  p_tracking_token text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.transactions AS t
    JOIN public.orders AS o ON o.id = t.order_id
    WHERE t.gateway_reference = p_gateway_reference
      AND o.tracking_token IS NOT NULL
      AND o.tracking_token <> ''
      AND o.tracking_token = p_tracking_token
  );
$$;

COMMENT ON FUNCTION public.verify_payment_reference_token(text, text) IS
  'Proof-bound guest authorization for payment reference verification: returns true only when the gateway reference belongs to an order carrying the supplied tracking token. Used by POST /api/payments/verify for sessionless checkouts.';

REVOKE ALL ON FUNCTION public.verify_payment_reference_token(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_payment_reference_token(text, text)
  TO anon, authenticated, service_role;
