-- Extend the single-use Ads OAuth state store to Google, Meta, and TikTok.
-- Snapchat retains its provider-specific RPCs from the preceding migration.

BEGIN;

ALTER TABLE public.merchant_ads_oauth_state_nonces
  DROP CONSTRAINT IF EXISTS merchant_ads_oauth_state_nonces_provider_check;

ALTER TABLE public.merchant_ads_oauth_state_nonces
  ADD CONSTRAINT merchant_ads_oauth_state_nonces_provider_check
  CHECK (provider IN ('google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'));

CREATE OR REPLACE FUNCTION public.reserve_merchant_ads_oauth_state_nonce(
  p_provider text,
  p_merchant_id uuid,
  p_user_id uuid,
  p_nonce text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
    OR NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    )
    OR p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads')
    OR p_nonce !~ '^[A-Za-z0-9_-]{16,128}$'
    OR p_expires_at <= pg_catalog.now()
    OR p_expires_at > pg_catalog.now() + pg_catalog.interval '15 minutes'
    OR p_redirect_uri <> (CASE p_provider
      WHEN 'google_ads' THEN 'https://usebaci.com/api/integrations/ads/google/callback'
      WHEN 'meta_ads' THEN 'https://usebaci.com/api/integrations/ads/meta/callback'
      WHEN 'tiktok_ads' THEN 'https://usebaci.com/api/integrations/ads/tiktok/callback'
      ELSE NULL
    END) THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ads_oauth_state_nonces
  WHERE provider = p_provider
    AND expires_at <= pg_catalog.now();

  INSERT INTO public.merchant_ads_oauth_state_nonces (
    provider, nonce, merchant_id, user_id, redirect_uri, expires_at
  ) VALUES (
    p_provider, p_nonce, p_merchant_id, p_user_id, p_redirect_uri, p_expires_at
  ) ON CONFLICT (provider, nonce) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_merchant_ads_oauth_state_nonce(
  p_provider text,
  p_merchant_id uuid,
  p_user_id uuid,
  p_nonce text,
  p_redirect_uri text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
    OR NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
    )
    OR p_provider NOT IN ('google_ads', 'meta_ads', 'tiktok_ads')
    OR p_nonce !~ '^[A-Za-z0-9_-]{16,128}$'
    OR p_redirect_uri <> (CASE p_provider
      WHEN 'google_ads' THEN 'https://usebaci.com/api/integrations/ads/google/callback'
      WHEN 'meta_ads' THEN 'https://usebaci.com/api/integrations/ads/meta/callback'
      WHEN 'tiktok_ads' THEN 'https://usebaci.com/api/integrations/ads/tiktok/callback'
      ELSE NULL
    END) THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ads_oauth_state_nonces
  WHERE provider = p_provider
    AND nonce = p_nonce
    AND merchant_id = p_merchant_id
    AND user_id = p_user_id
    AND redirect_uri = p_redirect_uri
    AND expires_at > pg_catalog.now();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text) TO authenticated;

COMMIT;
