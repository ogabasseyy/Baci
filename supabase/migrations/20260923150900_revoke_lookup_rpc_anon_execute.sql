BEGIN;

-- The baseline grants EXECUTE on every postgres-created function to anon
-- and authenticated via default privileges. The 150600/150700 lookup RPCs
-- revoked only PUBLIC, which does not remove those role-specific default
-- grants — so anon kept EXECUTE despite the authenticated-only design
-- (without a user session there is no ownership to prove). Revoke the
-- default anon grants explicitly, following the 150300 precedent.
REVOKE ALL ON FUNCTION public.authorize_sessionless_verify_reference(text)
  FROM anon;
REVOKE ALL ON FUNCTION public.get_order_notification_delivered(uuid)
  FROM anon;

COMMIT;
