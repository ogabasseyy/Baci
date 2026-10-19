-- Allow authorized merchant staff to hydrate and persist dashboard layouts.
--
-- The baseline dashboard_preferences policies are owner-only, while the
-- analytics dashboard exposes layout customization to staff with
-- settings.edit. Keep this projection limited to the merchant selected by
-- the row and the existing staff permission oracle: viewers (or editors) may
-- read the non-sensitive layout document, and only editors may write it.
-- Owners continue to pass through the existing owner policy and the
-- check_staff_permission owner short-circuit.

BEGIN;

ALTER TABLE public.dashboard_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_preferences_staff_select
  ON public.dashboard_preferences;
CREATE POLICY dashboard_preferences_staff_select
  ON public.dashboard_preferences
  FOR SELECT
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'settings',
      'view'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'settings',
      'edit'
    )
  );

DROP POLICY IF EXISTS dashboard_preferences_staff_insert
  ON public.dashboard_preferences;
CREATE POLICY dashboard_preferences_staff_insert
  ON public.dashboard_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'settings',
      'edit'
    )
  );

DROP POLICY IF EXISTS dashboard_preferences_staff_update
  ON public.dashboard_preferences;
CREATE POLICY dashboard_preferences_staff_update
  ON public.dashboard_preferences
  FOR UPDATE
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'settings',
      'edit'
    )
  )
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'settings',
      'edit'
    )
  );

COMMIT;
