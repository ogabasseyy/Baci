BEGIN;

-- PR 3468 post-merge hardening: close the proof-less completion path and
-- give the authenticated sessionless verify lane a wedge-recovery flag.
--
-- 1) The 151100 migration meant to leave "no callable path" for completion
--    without the server-only HMAC, but it dropped only the 3-arg
--    (uuid, text, boolean) signature. The 4-arg
--    (uuid, text, boolean, uuid) overload from 150800 is still granted to
--    anon/authenticated, so a tracking-token holder can complete without
--    the proof. Drop that overload; the 5-arg proof-bound signature is
--    the only completion entrypoint. No caller uses the 4-arg form (the
--    route passes p_completion_proof; replay checks use the 5-arg form).
--
-- 2) The Bearer [REDACTED] sessionless verify lane never stamps
--    guest_provider_confirmed (the guest flag RPC needs a tracking token
--    the lane does not carry), so a provider-confirmed payment whose
--    webhook was lost stays pending forever: the wedge sweep admits
--    non-Juicyway pending rows only with that flag. Add an
--    ownership-bound flag RPC that mirrors the sessionless snapshot's
--    auth.uid() customer check instead of the tracking token.

DROP FUNCTION IF EXISTS public.complete_immediate_order_notification_with_proof(uuid, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.flag_sessionless_payment_provider_confirmed(
  p_gateway_reference text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_gateway_reference IS NULL
    OR trim(p_gateway_reference) = '' THEN
    RETURN false;
  END IF;

  -- First flag wins: repeat polls must not bump updated_at and extend
  -- the sweep's webhook grace forever. Ownership mirrors
  -- get_sessionless_payment_reference_snapshot: the reference must
  -- belong to an order whose customer record is owned by auth.uid().
  UPDATE public.transactions AS t
  SET
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'guest_provider_confirmed', true,
      'guest_provider_confirmed_at', now()
    ),
    updated_at = now()
  WHERE t.gateway_reference = p_gateway_reference
    AND t.transaction_type = 'payment'
    AND t.status = 'pending'
    AND coalesce(t.metadata->>'guest_provider_confirmed', 'false')
      IS DISTINCT FROM 'true'
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      JOIN public.customers AS c ON c.id = o.customer_id
      WHERE o.id = t.order_id
        AND c.user_id = auth.uid()
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_sessionless_payment_provider_confirmed(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_sessionless_payment_provider_confirmed(text)
  TO authenticated, service_role;
-- Without a user session there is no ownership to prove.
REVOKE ALL ON FUNCTION public.flag_sessionless_payment_provider_confirmed(text)
  FROM anon;

COMMENT ON FUNCTION public.flag_sessionless_payment_provider_confirmed(text) IS
  'Enqueues a provider-verified pending sessionless payment for the privileged wedge sweep: verifies auth.uid() owns the reference order customer record, then stamps the matching pending payment transaction. The sweep re-verifies with the gateway before healing. Used by POST /api/payments/verify on the bearer-scoped client (no admin, no finalization).';

NOTIFY pgrst, 'reload schema';

COMMIT;
