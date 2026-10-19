-- Restrict direct spend-row reads to staff with analytics:view. Connection
-- metadata remains available to integrations:view staff through its existing
-- merchant_ad_connections_select policy.

BEGIN;

DROP POLICY IF EXISTS merchant_ad_spend_daily_select
  ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_select
  ON public.merchant_ad_spend_daily
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'analytics', 'view'
    )
  );

COMMIT;
