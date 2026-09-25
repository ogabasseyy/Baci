-- The orphan sweep is a worker-only operation.  Keep it out of the anon
-- surface and serialize it with the same merchant/shop lock used by the
-- self-authorization persistence RPC.
CREATE OR REPLACE FUNCTION public.purge_orphaned_jumia_authorizations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_candidate record;
BEGIN
  FOR v_candidate IN
    SELECT DISTINCT
      integration.merchant_id,
      integration.shop_id,
      integration.jumia_authorization_id
    FROM public.marketplace_integrations AS integration
    WHERE integration.platform = 'jumia'
      AND integration.is_active = false
      AND integration.jumia_authorization_id IS NOT NULL
  LOOP
    -- Match persist_jumia_self_authorization's lock key so reconnect and
    -- cleanup cannot detach the same provider shop concurrently.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_candidate.merchant_id::text || ':' || btrim(v_candidate.shop_id), 0
    ));

    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS active_integration
      WHERE active_integration.merchant_id = v_candidate.merchant_id
        AND active_integration.platform = 'jumia'
        AND active_integration.shop_id = btrim(v_candidate.shop_id)
        AND active_integration.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.marketplace_integrations
    SET jumia_authorization_id = NULL
    WHERE merchant_id = v_candidate.merchant_id
      AND platform = 'jumia'
      AND shop_id = btrim(v_candidate.shop_id)
      AND jumia_authorization_id = v_candidate.jumia_authorization_id
      AND is_active = false;

    -- Retain a shared authorization until every referencing shop has been
    -- processed under its own reconnect lock.
    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations
      WHERE jumia_authorization_id = v_candidate.jumia_authorization_id
        AND platform = 'jumia'
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.jumia_authorizations
    SET credential_ciphertext = repeat('0', 32), updated_at = now()
    WHERE id = v_candidate.jumia_authorization_id;

    DELETE FROM public.jumia_authorizations
    WHERE id = v_candidate.jumia_authorization_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations() FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorizations() TO service_role;
