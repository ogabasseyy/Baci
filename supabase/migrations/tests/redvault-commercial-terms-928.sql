DO $$
DECLARE
  trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'private.uba_redvault_applications'::regclass
      AND tgname = 'validate_redvault_commercial_terms'
  ) INTO trigger_exists;
  IF NOT trigger_exists THEN
    RAISE EXCEPTION 'REDVAULT commercial-term trigger missing';
  END IF;
END $$;
