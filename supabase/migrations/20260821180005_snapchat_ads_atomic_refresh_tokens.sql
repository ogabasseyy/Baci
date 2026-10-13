-- Preserve Snap refresh-token rotation with compare-and-swap semantics.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_snapchat_ads_connection_tokens(
  p_merchant_id uuid,
  p_current_refresh_token_ciphertext text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_token_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  )
    OR p_current_refresh_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$'
    OR p_access_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$'
    OR p_refresh_token_ciphertext !~ '^v2\.snapchat_ads\.[^.]+\.[^.]+\.[^.]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.merchant_ad_connections
  SET access_token_ciphertext = p_access_token_ciphertext,
      refresh_token_ciphertext = p_refresh_token_ciphertext,
      token_expires_at = p_token_expires_at
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads'
    AND refresh_token_ciphertext = p_current_refresh_token_ciphertext;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_snapchat_ads_connection_tokens(uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_snapchat_ads_connection_tokens(uuid, text, text, text, timestamptz) TO authenticated;

COMMIT;
