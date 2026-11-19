-- Apply the email fixture, in-app fixture, then in-app migration first.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
INSERT INTO public.merchant_onboarding_reminder_state VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',now()+interval '24 hours');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.merchant_onboarding_reminder_state) <> 1 THEN
    RAISE EXCEPTION 'owner cannot see own snooze';
  END IF;
  BEGIN
    INSERT INTO public.merchant_onboarding_reminder_state VALUES (
      '20000000-0000-4000-8000-000000000099',
      '10000000-0000-4000-8000-000000000001',now());
    RAISE EXCEPTION 'cross merchant insertion allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.merchant_onboarding_reminder_state
      SET user_id='10000000-0000-4000-8000-000000000099';
    RAISE EXCEPTION 'owner can assign snooze to other user';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.merchant_onboarding_reminder_state) THEN
    RAISE EXCEPTION 'other owner can read snooze';
  END IF;
END $$;
RESET ROLE;
UPDATE public.merchants SET user_id='10000000-0000-4000-8000-000000000099'
  WHERE id='20000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.merchant_onboarding_reminder_state) THEN
    RAISE EXCEPTION 'former owner retains access';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_table_privilege('anon','public.merchant_onboarding_reminder_state','SELECT') THEN
    RAISE EXCEPTION 'anonymous snooze access';
  END IF;
END $$;
