-- Keep a claimed discovery alive for the full claim window. Without this,
-- selecting a shop near the original ten-minute expiry can lose a rotated
-- refresh credential before the selection RPC finishes.

CREATE OR REPLACE FUNCTION public.claim_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_client_key_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_claim_token uuid := gen_random_uuid();
  v_credential_ciphertext text;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jumia_self_authorization_discoveries AS discovery
  SET claim_token = v_claim_token,
      claim_expires_at = now() + interval '2 minutes',
      expires_at = GREATEST(discovery.expires_at, now() + interval '2 minutes')
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.client_key_hash = p_client_key_hash
    AND discovery.consumed_at IS NULL
    AND discovery.expires_at > now()
    AND (
      discovery.claim_token IS NULL
      OR discovery.claim_expires_at <= now()
    )
  RETURNING discovery.credential_ciphertext
  INTO v_credential_ciphertext;

  IF v_credential_ciphertext IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'claim_token', v_claim_token,
    'credential_ciphertext', v_credential_ciphertext
  );
END;
$$;
