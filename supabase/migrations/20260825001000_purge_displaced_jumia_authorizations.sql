-- Reactivating a disconnected Jumia marketplace can replace its authorization.
-- Purge the displaced encrypted grant in the same transaction once its final
-- integration reference moves away.
CREATE OR REPLACE FUNCTION public.purge_displaced_jumia_authorization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.platform = 'jumia'
    AND OLD.jumia_authorization_id IS NOT NULL
    AND OLD.jumia_authorization_id IS DISTINCT FROM NEW.jumia_authorization_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.jumia_authorization_id = OLD.jumia_authorization_id
    )
  THEN
    UPDATE public.jumia_authorizations
    SET credential_ciphertext = repeat('0', 32), updated_at = now()
    WHERE id = OLD.jumia_authorization_id;

    DELETE FROM public.jumia_authorizations
    WHERE id = OLD.jumia_authorization_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.marketplace_integrations AS integration
        WHERE integration.jumia_authorization_id = OLD.jumia_authorization_id
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_displaced_jumia_authorization()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purge_displaced_jumia_authorization
  ON public.marketplace_integrations;
CREATE TRIGGER purge_displaced_jumia_authorization
AFTER UPDATE OF jumia_authorization_id ON public.marketplace_integrations
FOR EACH ROW
EXECUTE FUNCTION public.purge_displaced_jumia_authorization();
