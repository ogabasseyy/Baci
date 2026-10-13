-- Restrict direct Ads connection metadata reads to dashboard viewers.
--
-- The original Google Ads migration granted SELECT to every authenticated
-- merchant member. Connection metadata is consumed by analytics and
-- integration-status surfaces, so membership alone must not bypass the
-- corresponding dashboard permissions. Credential columns remain protected
-- by the existing column grants and server-only RPC boundary.

BEGIN;

ALTER TABLE public.merchant_ad_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_ad_connections_select
  ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_select
  ON public.merchant_ad_connections
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'analytics', 'view'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'integrations', 'view'
    )
  );

COMMIT;
