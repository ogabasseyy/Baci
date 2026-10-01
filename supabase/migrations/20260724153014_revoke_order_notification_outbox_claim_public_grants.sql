-- Keep the order-notification claim worker internal to the service role.
-- Supabase can materialize explicit anon/authenticated EXECUTE grants, so
-- revoking only PUBLIC does not remove those role-specific privileges.
REVOKE ALL ON FUNCTION public.claim_order_notification_outbox(integer, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_order_notification_outbox(integer, text)
  TO service_role;
