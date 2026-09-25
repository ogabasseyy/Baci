-- Periodically remove credentials left behind when a disconnect purge could
-- not complete.  The caller is protected by the CRON_SECRET route; the
-- narrowly scoped SECURITY DEFINER function avoids exposing credential rows
-- to the cron client.
CREATE OR REPLACE FUNCTION public.purge_orphaned_jumia_authorizations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_authorization_id uuid;
BEGIN
  FOR v_authorization_id IN
    SELECT DISTINCT integration.jumia_authorization_id
    FROM public.marketplace_integrations AS integration
    WHERE integration.platform = 'jumia'
      AND integration.is_active = false
      AND integration.jumia_authorization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.marketplace_integrations AS active_integration
        WHERE active_integration.platform = 'jumia'
          AND active_integration.is_active = true
          AND active_integration.jumia_authorization_id = integration.jumia_authorization_id
      )
  LOOP
    UPDATE public.marketplace_integrations
    SET jumia_authorization_id = NULL
    WHERE jumia_authorization_id = v_authorization_id
      AND platform = 'jumia'
      AND is_active = false;

    -- A connection can be reactivated while this sweep is running.  Never
    -- delete a grant that has acquired an active integration in the meantime.
    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations
      WHERE jumia_authorization_id = v_authorization_id
        AND platform = 'jumia'
        AND is_active = true
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.jumia_authorizations
    SET credential_ciphertext = repeat('0', 32), updated_at = now()
    WHERE id = v_authorization_id;

    DELETE FROM public.jumia_authorizations
    WHERE id = v_authorization_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorizations() TO anon;
