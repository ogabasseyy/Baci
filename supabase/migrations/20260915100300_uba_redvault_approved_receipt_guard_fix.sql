-- The protected approval transaction flips the attempt to approved and then
-- appends completion_receipt / inventory_completion_receipt in a second
-- update. The replay guard must allow those receipt-only appends while still
-- rejecting capture-replay overwrites that touch any other key or delete
-- existing content.
CREATE OR REPLACE FUNCTION private.preserve_uba_redvault_approved_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.state = 'approved' AND NEW.state IS DISTINCT FROM 'approved' THEN
    RETURN OLD;
  END IF;
  IF OLD.state = 'approved' AND NEW.provider_response IS DISTINCT FROM OLD.provider_response THEN
    IF (OLD.provider_response IS NOT NULL AND NOT (OLD.provider_response <@ NEW.provider_response))
      OR (COALESCE(NEW.provider_response, '{}'::jsonb) - 'completion_receipt' - 'inventory_completion_receipt')
         IS DISTINCT FROM
         (COALESCE(OLD.provider_response, '{}'::jsonb) - 'completion_receipt' - 'inventory_completion_receipt') THEN
      RETURN OLD;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.preserve_uba_redvault_approved_capture() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.preserve_uba_redvault_approved_capture()
  FROM PUBLIC, anon, authenticated, service_role;
