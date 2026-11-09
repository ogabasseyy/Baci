-- Keep the provider-dispatch admission RPC unreachable until a separately
-- reviewed recovery migration explicitly restores a restricted execution grant.
-- The rollout flag alone must never be enough to create an unresolved hold.
BEGIN;

REVOKE ALL ON FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(text)
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

COMMENT ON FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(text) IS
  'Dormant dispatch foundation: execution remains revoked until a reviewed recovery migration explicitly restores a restricted caller grant.';

COMMIT;
