-- Snapchat-specific OAuth nonce consumption and disconnect data erasure.
-- This is deliberately append-only: provider-neutral RPCs remain unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS public.merchant_ads_oauth_state_nonces (
  provider text NOT NULL CHECK (provider = 'snapchat_ads'),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 128),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, nonce)
);

CREATE INDEX IF NOT EXISTS merchant_ads_oauth_state_nonces_expiry_idx
  ON public.merchant_ads_oauth_state_nonces (expires_at);

ALTER TABLE public.merchant_ads_oauth_state_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_ads_oauth_state_nonces FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_snapchat_ads_oauth_state_nonce(
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
    OR p_nonce !~ '^[A-Za-z0-9_-]{16,128}$'
    OR p_redirect_uri <> 'https://usebaci.com/api/integrations/ads/snapchat/callback'
    OR p_expires_at <= pg_catalog.now()
    OR p_expires_at > pg_catalog.now() + pg_catalog.interval '15 minutes' THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ads_oauth_state_nonces
  WHERE expires_at <= pg_catalog.now();

  INSERT INTO public.merchant_ads_oauth_state_nonces (
    provider, nonce, merchant_id, user_id, redirect_uri, expires_at
  ) VALUES (
    'snapchat_ads', p_nonce, p_merchant_id, p_user_id, p_redirect_uri, p_expires_at
  ) ON CONFLICT (provider, nonce) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_snapchat_ads_oauth_state_nonce(
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
    OR p_nonce !~ '^[A-Za-z0-9_-]{16,128}$'
    OR p_redirect_uri <> 'https://usebaci.com/api/integrations/ads/snapchat/callback' THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ads_oauth_state_nonces
  WHERE provider = 'snapchat_ads'
    AND nonce = p_nonce
    AND merchant_id = p_merchant_id
    AND user_id = p_user_id
    AND redirect_uri = p_redirect_uri
    AND expires_at > pg_catalog.now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_snapchat_ads_connection_and_spend(
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection_deleted boolean := false;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads';

  DELETE FROM public.merchant_ad_connections
  WHERE merchant_id = p_merchant_id
    AND provider = 'snapchat_ads';
  v_connection_deleted := FOUND;
  RETURN v_connection_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_snapchat_ads_connection_and_spend(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_snapchat_ads_connection_and_spend(uuid) TO authenticated;

COMMIT;
