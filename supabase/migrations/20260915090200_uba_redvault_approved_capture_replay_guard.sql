CREATE OR REPLACE FUNCTION private.preserve_uba_redvault_approved_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.state = 'approved' AND NEW.state IS DISTINCT FROM 'approved' THEN
    RETURN OLD;
  END IF;
  IF OLD.state = 'approved' AND NEW.provider_response IS DISTINCT FROM OLD.provider_response THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.preserve_uba_redvault_approved_capture() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.preserve_uba_redvault_approved_capture()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS preserve_uba_redvault_approved_capture
  ON private.uba_redvault_payment_attempts;
CREATE TRIGGER preserve_uba_redvault_approved_capture
  BEFORE UPDATE OF state, provider_response ON private.uba_redvault_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.preserve_uba_redvault_approved_capture();
