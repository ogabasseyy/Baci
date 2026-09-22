-- Harden the guest verification snapshot: the anon-granted function
-- previously returned gateway_response, transaction metadata, and
-- platform_fee, which callers can invoke directly through
-- Supabase/PostgREST past the API route's response filtering. The guest
-- verifier only needs identity, status, and amount fields, so drop the
-- raw provider payloads and internal fee data from the projection. The
-- access control (exact gateway reference plus matching order tracking
-- token, order-bound rows only, no existence oracle) is unchanged.

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
  'Proof-bound guest read model for payment reference verification: returns verification fields (identity, status, amounts) only — never raw provider payloads or fee data. Returns a row only when the gateway reference belongs to an order carrying the supplied tracking token. Used by POST /api/payments/verify for sessionless checkouts (read-only; finalization stays on the webhook boundary).';

REVOKE ALL ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  TO anon, authenticated, service_role;
