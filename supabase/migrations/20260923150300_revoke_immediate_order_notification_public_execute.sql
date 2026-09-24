BEGIN;

-- The baseline grants EXECUTE on every postgres-created function to anon
-- and authenticated via default privileges. The original claim
-- migration revoked only PUBLIC, which does not remove those
-- role-specific default grants — so the immediate-order claim/complete
-- RPCs stayed publicly executable despite their service-role-only
-- design (any caller could mark any order's notification sent or
-- failed). Revoke the default grants explicitly so only service_role
-- (the after() delivery path) can drive delivery state.
REVOKE ALL ON FUNCTION public.claim_immediate_order_notification(uuid)
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_immediate_order_notification(
  uuid, boolean
)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.claim_immediate_order_notification(uuid) IS
  'Atomically takes ownership of an order''s immediate notification. Service-role-only: revoked from anon/authenticated (baseline default privileges would otherwise expose it).';

COMMIT;
