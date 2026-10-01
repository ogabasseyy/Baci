-- Restore the GIGL worker to a signed PostgREST capability. A direct LOGIN can
-- set request.jwt.claim.* itself and therefore cannot be constrained by the
-- wrapper claim checks. Keep the signing key outside the VPS; the host receives
-- only a time-bounded JWT whose role is gigl_tracking_worker.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigl_tracking_worker') THEN
    RAISE EXCEPTION 'gigl_tracking_worker capability role is missing';
  END IF;
END
$$;

ALTER ROLE gigl_tracking_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;
-- Authenticator membership is granted by the isolate migration together
-- with the request-scope hook, so the token is never usable unconfined.

COMMENT ON ROLE gigl_tracking_worker IS
  'Signed PostgREST capability for the VPS GIGL poller; no direct login';
