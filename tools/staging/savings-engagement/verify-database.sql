\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802'
    OR (SELECT count(*) FROM public.customers) <> 1 THEN
    RAISE EXCEPTION 'Unexpected staging identity';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', user_id::text, true),
  set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true),
  set_config('engagement.test_merchant', merchant_id::text, true)
FROM public.customers WHERE deleted_at IS NULL \gset
SET LOCAL ROLE authenticated;
DO $$ DECLARE
  merchant uuid := current_setting('engagement.test_merchant')::uuid;
  earnings jsonb;
  inbox jsonb;
BEGIN
  earnings := public.get_customer_savings_earnings(merchant);
  IF (earnings->>'credited_interest_kobo')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Unexpected staging earnings fixture';
  END IF;
  inbox := public.get_customer_savings_notifications(merchant);
  IF jsonb_typeof(inbox->'notifications') IS DISTINCT FROM 'array'
    OR inbox->'preferences'->>'quietHoursStart' IS DISTINCT FROM '22:00' THEN
    RAISE EXCEPTION 'Unexpected inbox response';
  END IF;
  PERFORM public.update_customer_savings_notification_preferences(merchant, '{"weeklySummaryEnabled":true}'::jsonb);
  IF (public.get_customer_savings_notifications(merchant)->'preferences'->>'weeklySummaryEnabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Preference round trip failed';
  END IF;
  IF public.mark_customer_savings_notification_read(merchant, gen_random_uuid()) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Missing notification must not be marked read';
  END IF;
  BEGIN
    PERFORM public.get_customer_savings_notifications(gen_random_uuid());
    RAISE EXCEPTION 'Cross-merchant read was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_table_privilege('baci_savings_notifications_worker', 'public.customers', 'SELECT')
    OR has_table_privilege('baci_savings_notifications_worker', 'savings_notifications.events', 'SELECT')
    OR NOT has_function_privilege('baci_savings_notifications_worker', 'savings_notifications.claim_push(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Worker grants do not match the restricted contract';
  END IF;
END $$;
ROLLBACK;
\echo SAVINGS_ENGAGEMENT_DATABASE_VERIFIED
