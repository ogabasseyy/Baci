-- Serialize handoff issuance with device retirement, mirroring the
-- redeem wrapper (20261014120400) and the mutation wrapper
-- (20261015100000): commerce_cart_device_is_active takes the
-- cc-device-revoke advisory lock for the caller's device before the
-- implementation reads grant liveness, so a handoff can no longer be
-- minted in the window between a device retirement being recorded and
-- its grant revocations becoming visible to the issuer.
ALTER FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb)
  RENAME TO commerce_cart_issue_handoff_device_impl;

REVOKE ALL ON FUNCTION public.commerce_cart_issue_handoff_device_impl(text, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, commerce_cart_shopper, commerce_cart_receiver, commerce_cart_worker;

CREATE OR REPLACE FUNCTION public.commerce_cart_issue_handoff(
  p_token_hash text,
  p_handoff_id uuid,
  p_cart_id uuid,
  p_operation_id text,
  p_destination jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.commerce_cart_device_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false);
  END IF;
  RETURN public.commerce_cart_issue_handoff_device_impl(
    p_token_hash, p_handoff_id, p_cart_id, p_operation_id, p_destination
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb)
  TO commerce_cart_shopper;
