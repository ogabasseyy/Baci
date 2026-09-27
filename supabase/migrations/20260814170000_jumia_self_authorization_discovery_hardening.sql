-- Harden Jumia self-authorization discovery handoff:
-- FK indexes, authenticated RPC access, delete-on-consume, and expiry cleanup.

CREATE INDEX IF NOT EXISTS idx_jumia_self_authorization_discoveries_merchant_id
  ON public.jumia_self_authorization_discoveries (merchant_id);

CREATE INDEX IF NOT EXISTS idx_jumia_self_authorization_discoveries_user_id
  ON public.jumia_self_authorization_discoveries (user_id);

CREATE OR REPLACE FUNCTION public.create_jumia_self_authorization_discovery(
  p_merchant_id uuid,
  p_client_key_hash text,
  p_credential_ciphertext text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_discovery_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id
        AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id,
      p_merchant_id,
      'integrations',
      'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  IF p_client_key_hash !~ '^[a-f0-9]{64}$'
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
  THEN
    RAISE EXCEPTION 'Invalid Jumia discovery metadata'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.jumia_self_authorization_discoveries (
    merchant_id,
    user_id,
    client_key_hash,
    credential_ciphertext,
    expires_at
  ) VALUES (
    p_merchant_id,
    v_user_id,
    p_client_key_hash,
    p_credential_ciphertext,
    now() + interval '10 minutes'
  )
  RETURNING id INTO v_discovery_id;

  RETURN v_discovery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_client_key_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_credential_ciphertext text;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id
        AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id,
      p_merchant_id,
      'integrations',
      'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.jumia_self_authorization_discoveries AS discovery
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.client_key_hash = p_client_key_hash
    AND discovery.consumed_at IS NULL
    AND discovery.expires_at > now()
  RETURNING discovery.credential_ciphertext
  INTO v_credential_ciphertext;

  RETURN v_credential_ciphertext;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_jumia_self_authorization_discoveries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.jumia_self_authorization_discoveries AS discovery
  WHERE discovery.expires_at <= now()
     OR discovery.consumed_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.create_jumia_self_authorization_discovery(
  uuid,
  text,
  text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.consume_jumia_self_authorization_discovery(
  uuid,
  uuid,
  text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.purge_expired_jumia_self_authorization_discoveries()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_jumia_self_authorization_discovery(
  uuid,
  text,
  text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.consume_jumia_self_authorization_discovery(
  uuid,
  uuid,
  text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.purge_expired_jumia_self_authorization_discoveries()
TO service_role;
