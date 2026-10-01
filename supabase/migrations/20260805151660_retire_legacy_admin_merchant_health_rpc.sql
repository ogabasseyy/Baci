-- The paginated v2 reader is the only supported merchant-directory surface.
-- Retain the legacy function for migration compatibility, but make it
-- ineligible for direct PostgREST execution so its unbounded response cannot
-- become a stale alternate analytics path.

BEGIN;

REVOKE ALL ON FUNCTION public.get_admin_merchant_health()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_merchant_health() IS
  'Retired. Use public.get_admin_merchant_health_v2(integer, integer, text, text, text).';

COMMIT;
