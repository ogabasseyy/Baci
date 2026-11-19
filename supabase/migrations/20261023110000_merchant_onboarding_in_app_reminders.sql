-- Sparse snooze state only; reminder content is derived from live launch readiness.
CREATE TABLE public.merchant_onboarding_reminder_state (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snoozed_until timestamptz NOT NULL,
  PRIMARY KEY (merchant_id, user_id)
);
CREATE INDEX merchant_onboarding_reminder_state_user_idx
  ON public.merchant_onboarding_reminder_state(user_id);
ALTER TABLE public.merchant_onboarding_reminder_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_onboarding_reminder_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.merchant_onboarding_reminder_state TO authenticated;

CREATE POLICY onboarding_reminder_owner_select
  ON public.merchant_onboarding_reminder_state FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = (SELECT auth.uid())
  ));
CREATE POLICY onboarding_reminder_owner_insert
  ON public.merchant_onboarding_reminder_state FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = (SELECT auth.uid())
  ));
CREATE POLICY onboarding_reminder_owner_update
  ON public.merchant_onboarding_reminder_state FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = merchant_id AND m.user_id = (SELECT auth.uid())
  ));
