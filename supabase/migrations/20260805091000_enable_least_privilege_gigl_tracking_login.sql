-- Use the dedicated capability role as a direct database login from the VPS.
-- Its password is provisioned and rotated out-of-band; secrets never enter
-- migration history. The role retains only schema usage and EXECUTE on the
-- five lease-bound wrappers granted by 20260805090000.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigl_tracking_worker') THEN
    RAISE EXCEPTION 'gigl_tracking_worker capability role is missing';
  END IF;
END
$$;

-- Idempotent guard: the add migration grants no membership, so this is a
-- no-op on fresh chains and only cleans partially-applied states.
REVOKE gigl_tracking_worker FROM authenticator;
ALTER ROLE gigl_tracking_worker LOGIN CONNECTION LIMIT 2;

COMMENT ON ROLE gigl_tracking_worker IS
  'VPS GIGL tracking poller; execute-only capability with externally rotated password';
