-- Restrict credential reissue to the linked owner and revocation to the grant
-- holder with live merchant access or the current merchant owner.

CREATE OR REPLACE FUNCTION public.reissue_connector_grant_tokens(
  p_grant_id uuid,
  p_new_token_hash text,
  p_new_refresh_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_grant record;
BEGIN
  v_caller := (SELECT auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT merchant_id, user_id, status, expires_at INTO v_grant
  FROM public.connector_grants
  WHERE id = p_grant_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_grant.user_id IS DISTINCT FROM v_caller OR NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_grant.merchant_id AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;
  IF p_new_refresh_token_hash IS NOT NULL
    AND p_new_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant_token';
  END IF;

  IF v_grant.status <> 'active'
    OR (v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now()) THEN
    RETURN false;
  END IF;

  UPDATE public.connector_grants
  SET token_hash = p_new_token_hash,
      refresh_token_hash = p_new_refresh_token_hash,
      version = version + 1,
      updated_at = now()
  WHERE id = p_grant_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_connector_grant(
  p_grant_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
  v_user_id uuid;
  v_caller uuid;
BEGIN
  v_caller := (SELECT auth.uid());
  SELECT merchant_id, user_id INTO v_merchant_id, v_user_id
  FROM public.connector_grants
  WHERE id = p_grant_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_caller IS NULL OR NOT public.has_merchant_access(v_merchant_id)
    OR (v_user_id IS DISTINCT FROM v_caller AND NOT EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = v_merchant_id AND m.user_id = v_caller
    )) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.connector_grants
  SET status = 'revoked',
      revoked_at = now(),
      revoke_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
      refresh_token_hash = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = p_grant_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;
