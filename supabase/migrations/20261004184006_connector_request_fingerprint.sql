-- Bind stable connection IDs to the requested permissions and expiry.
-- Legacy grants have no request receipt; they cannot safely recover an
-- idempotent create because their originally requested lifetime is unknown.
ALTER TABLE public.connector_grants
  ADD COLUMN IF NOT EXISTS request_fingerprint text
  CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');

GRANT SELECT (request_fingerprint) ON public.connector_grants TO authenticated;

CREATE OR REPLACE FUNCTION public.create_connector_grant_for_request(
  p_merchant_id uuid,
  p_connection_id text,
  p_branch_ids uuid[],
  p_scopes text[],
  p_merchant_wide boolean,
  p_expires_at timestamptz,
  p_token_hash text,
  p_refresh_token_hash text,
  p_request_fingerprint text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_grant_id uuid;
BEGIN
  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = p_merchant_id AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_connector_grant';
  END IF;
  -- Keep existing live membership, scope, branch and credential checks.
  v_grant_id := public.create_connector_grant(
    p_merchant_id, p_connection_id, p_branch_ids, p_scopes,
    p_merchant_wide, p_expires_at, p_token_hash, p_refresh_token_hash
  );
  UPDATE public.connector_grants
  SET request_fingerprint = p_request_fingerprint
  WHERE id = v_grant_id AND user_id = v_caller AND merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connector_grant_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_grant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_connector_grant_for_request(
  uuid, text, uuid[], text[], boolean, timestamptz, text, text, text
) FROM PUBLIC, anon, connector_gateway;
GRANT EXECUTE ON FUNCTION public.create_connector_grant_for_request(
  uuid, text, uuid[], text[], boolean, timestamptz, text, text, text
) TO authenticated;
