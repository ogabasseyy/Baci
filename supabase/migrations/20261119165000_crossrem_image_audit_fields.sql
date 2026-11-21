-- These fields record verification attempts and are absent from the feed
-- projection, eligibility filters, and image ordering. Ignore only this
-- audited list so a new source column invalidates snapshots by default.
CREATE OR REPLACE FUNCTION public.bump_crossrem_image_update_generation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  audit_columns constant text[] := ARRAY[
    'last_checked_at', 'created_at', 'updated_at', 'verified_at', 'failure_reason'
  ];
BEGIN
  IF (pg_catalog.to_jsonb(OLD) - audit_columns) IS DISTINCT FROM
     (pg_catalog.to_jsonb(NEW) - audit_columns) THEN
    UPDATE public.crossrem_catalog_generations
    SET revision = pg_catalog.gen_random_uuid()
    WHERE merchant_id IN (OLD.merchant_id, NEW.merchant_id);
  END IF;

  RETURN NULL;
END;
$$;
