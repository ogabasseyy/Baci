-- Require the version observed by the owner route for credential reissue.
DROP FUNCTION public.reissue_connector_grant_tokens(uuid,text,text);
CREATE OR REPLACE FUNCTION public.reissue_connector_grant_tokens(
  p_grant_id uuid,
  p_new_token_hash text,
  p_new_refresh_token_hash text,
  p_expected_version integer
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
    AND status = 'active'
    AND version = p_expected_version;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_connector_grant_tokens(uuid,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reissue_connector_grant_tokens(uuid,text,text,integer) TO authenticated;
