-- Acquire every provider-shop lock in one deterministic order before the
-- existing persistence implementation performs conflict checks and writes.

CREATE OR REPLACE FUNCTION public.persist_jumia_self_authorization_ordered(
  p_merchant_id uuid,
  p_client_key_hash text,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_shop_ids text[],
  p_shop_names text[],
  p_country_codes text[],
  p_marketplace_labels text[],
  p_business_client_codes text[]
)
RETURNS TABLE (
  authorization_id uuid,
  integration_id uuid,
  shop_id text,
  inserted boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_shop_id text;
BEGIN
  IF p_merchant_id IS NULL OR p_shop_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  FOR v_shop_id IN
    SELECT DISTINCT btrim(selected.shop_id)
    FROM unnest(p_shop_ids) AS selected(shop_id)
    WHERE selected.shop_id IS NOT NULL AND btrim(selected.shop_id) <> ''
    ORDER BY btrim(selected.shop_id)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_merchant_id::text || ':' || v_shop_id, 0
    ));
  END LOOP;

  RETURN QUERY
  SELECT persisted.authorization_id,
         persisted.integration_id,
         persisted.shop_id,
         persisted.inserted
  FROM public.persist_jumia_self_authorization(
    p_merchant_id,
    p_client_key_hash,
    p_credential_ciphertext,
    p_token_expires_at,
    p_refresh_token_expires_at,
    p_shop_ids,
    p_shop_names,
    p_country_codes,
    p_marketplace_labels,
    p_business_client_codes
  ) AS persisted;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_self_authorization_ordered(
  uuid, text, text, timestamptz, timestamptz,
  text[], text[], text[], text[], text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization_ordered(
  uuid, text, text, timestamptz, timestamptz,
  text[], text[], text[], text[], text[]
) TO authenticated;
