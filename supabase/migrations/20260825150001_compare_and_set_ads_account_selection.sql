BEGIN;

CREATE OR REPLACE FUNCTION public.set_google_ads_customer(
  p_merchant_id pg_catalog.uuid,
  p_provider_customer_id pg_catalog.text,
  p_expected_access_token_ciphertext pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider_customer_id !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'invalid Google Ads customer id';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = p_provider_customer_id,
      last_synced_at = CASE
        WHEN provider_customer_id IS DISTINCT FROM p_provider_customer_id
          THEN NULL
        ELSE last_synced_at
      END
  WHERE merchant_id = p_merchant_id
    AND provider = 'google_ads'
    AND access_token_ciphertext IS NOT DISTINCT FROM p_expected_access_token_ciphertext;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_merchant_ads_account(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_provider_customer_id pg_catalog.text,
  p_provider_account_label pg_catalog.text,
  p_account_timezone pg_catalog.text,
  p_attribution_metadata pg_catalog.jsonb,
  p_expected_access_token_ciphertext pg_catalog.text
)
RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN false;
  END IF;
  IF p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR pg_catalog.char_length(p_provider_customer_id) > 255
    OR pg_catalog.btrim(p_provider_customer_id) = ''
    OR (p_provider_account_label IS NOT NULL
      AND pg_catalog.char_length(p_provider_account_label) > 255)
    OR (p_account_timezone IS NOT NULL
      AND (pg_catalog.char_length(p_account_timezone) > 128
        OR p_account_timezone !~ '^[A-Za-z_+/-]+$'))
    OR pg_catalog.jsonb_typeof(
      COALESCE(p_attribution_metadata, '{}'::pg_catalog.jsonb)
    ) <> 'object' THEN
    RAISE EXCEPTION 'invalid ads account input';
  END IF;
  UPDATE public.merchant_ad_connections
  SET provider_customer_id = pg_catalog.btrim(p_provider_customer_id),
      provider_account_label = NULLIF(
        pg_catalog.btrim(p_provider_account_label), ''
      ),
      account_timezone = NULLIF(pg_catalog.btrim(p_account_timezone), ''),
      attribution_metadata = COALESCE(
        p_attribution_metadata, '{}'::pg_catalog.jsonb
      ),
      last_synced_at = CASE
        WHEN provider_customer_id IS DISTINCT FROM pg_catalog.btrim(
          p_provider_customer_id
        ) THEN NULL
        ELSE last_synced_at
      END
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND access_token_ciphertext IS NOT DISTINCT FROM p_expected_access_token_ciphertext;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_google_ads_customer(
  pg_catalog.uuid, pg_catalog.text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_merchant_ads_account(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.text,
  pg_catalog.text, pg_catalog.jsonb
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_google_ads_customer(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_google_ads_customer(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_merchant_ads_account(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.text,
  pg_catalog.text, pg_catalog.jsonb, pg_catalog.text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_merchant_ads_account(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.text,
  pg_catalog.text, pg_catalog.jsonb, pg_catalog.text
) TO authenticated, service_role;

COMMIT;
