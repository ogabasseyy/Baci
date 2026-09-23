-- Detach every inactive integration that references a shared grant before
-- deleting it. The sweep locks all of the affected provider shops in sorted
-- order, then the authorization, matching disconnect/reconnect lock order.
CREATE OR REPLACE FUNCTION public.purge_orphaned_jumia_authorizations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_candidate record;
  v_shop_id text;
BEGIN
  FOR v_candidate IN
    SELECT
      integration.merchant_id,
      min(btrim(integration.shop_id)) AS shop_id,
      integration.jumia_authorization_id,
      array_agg(
        DISTINCT btrim(integration.shop_id)
        ORDER BY btrim(integration.shop_id)
      ) AS shop_ids
    FROM public.marketplace_integrations AS integration
    WHERE integration.platform = 'jumia'
      AND integration.is_active = false
      AND integration.jumia_authorization_id IS NOT NULL
    GROUP BY integration.merchant_id, integration.jumia_authorization_id
    ORDER BY integration.merchant_id, integration.jumia_authorization_id
  LOOP
    FOR v_shop_id IN
      SELECT shop_id
      FROM unnest(v_candidate.shop_ids) AS shops(shop_id)
      ORDER BY shop_id
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_candidate.merchant_id::text || ':' || v_shop_id, 0
      ));
    END LOOP;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_candidate.merchant_id::text || ':authorization:' ||
        v_candidate.jumia_authorization_id::text, 0
    ));

    -- A reconnect can win while the candidate was waiting for the locks.
    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS active_integration
      WHERE active_integration.merchant_id = v_candidate.merchant_id
        AND active_integration.platform = 'jumia'
        AND active_integration.jumia_authorization_id = v_candidate.jumia_authorization_id
        AND active_integration.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Keep this shop-scoped update explicit for compatibility with the
    -- disconnect/reconnect contract, then detach any remaining inactive
    -- siblings that share this authorization.
    UPDATE public.marketplace_integrations
    SET jumia_authorization_id = NULL
    WHERE merchant_id = v_candidate.merchant_id
      AND shop_id = btrim(v_candidate.shop_id)
      AND platform = 'jumia'
      AND jumia_authorization_id = v_candidate.jumia_authorization_id
      AND is_active = false;

    UPDATE public.marketplace_integrations
    SET jumia_authorization_id = NULL
    WHERE merchant_id = v_candidate.merchant_id
      AND platform = 'jumia'
      AND jumia_authorization_id = v_candidate.jumia_authorization_id
      AND is_active = false;

    -- Re-check after detaching all inactive references. Never delete a grant
    -- that is still referenced by an active marketplace.
    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations
      WHERE merchant_id = v_candidate.merchant_id
        AND platform = 'jumia'
        AND jumia_authorization_id = v_candidate.jumia_authorization_id
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.jumia_authorizations
    SET credential_ciphertext = repeat('0', 32), updated_at = now()
    WHERE id = v_candidate.jumia_authorization_id
      AND merchant_id = v_candidate.merchant_id;

    DELETE FROM public.jumia_authorizations
    WHERE id = v_candidate.jumia_authorization_id
      AND merchant_id = v_candidate.merchant_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorizations()
  TO service_role;
