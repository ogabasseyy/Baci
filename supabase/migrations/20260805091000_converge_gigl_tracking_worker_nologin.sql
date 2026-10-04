-- Re-assert the worker role as NOLOGIN with no password and revoke
-- any interim membership. The add migration converges before granting
-- (first defense); this file is the backstop, so a stall anywhere in
-- the chain still leaves no login window. An earlier revision of this
-- file enabled interim direct LOGIN, but nothing consumes it: the
-- poller authenticates by worker JWT over PostgREST, and a LOGIN-capable
-- role inherits every EXECUTE grant made to PUBLIC while forging
-- request.jwt.claim.* at will, so "five wrappers only" cannot hold for
-- a direct session.

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
ALTER ROLE gigl_tracking_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;

COMMENT ON ROLE gigl_tracking_worker IS
  'Signed PostgREST capability for the VPS GIGL poller; no direct login';
