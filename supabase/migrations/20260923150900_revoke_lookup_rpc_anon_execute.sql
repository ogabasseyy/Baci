BEGIN;

-- The baseline grants EXECUTE on every postgres-created function to anon
-- and authenticated via default privileges. The 150700 lookup RPC
-- revoked only PUBLIC, which does not remove those role-specific default
-- grants — so anon kept EXECUTE despite the authenticated-only design
-- (without a user session there is no ownership to prove). Revoke the
-- default anon grant explicitly, following the 150300 precedent.
-- (The 151000 sessionless snapshot already revokes anon inline.)
REVOKE ALL ON FUNCTION public.get_order_notification_delivered(uuid)
  FROM anon;

COMMIT;
