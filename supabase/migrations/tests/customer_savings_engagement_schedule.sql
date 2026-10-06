BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id) VALUES ('11000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
 ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,contribution_frequency,start_date,maturity_date) VALUES
 ('44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','daily','2026-09-01','2026-12-01'),
 ('44000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','monthly','2026-01-31','2026-12-01'),
 ('44000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','weekly','2026-09-07','2026-12-01');
SELECT set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
SELECT savings_notifications.generate_due('2026-09-28T10:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM savings_notifications.events WHERE type='weekly_summary'), 'Digest off by default');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM savings_notifications.events WHERE type='missed_contribution'), 'Daily weekly monthly due contributions generate one gentle nudge');
SELECT savings_notifications.generate_due('2026-09-28T10:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM savings_notifications.events), 'Repeated scheduler does not duplicate');
SELECT public.update_customer_savings_notification_preferences('11000000-0000-4000-8000-000000000001','{"weeklySummaryEnabled":true,"encouragementEnabled":false}');
SELECT savings_notifications.generate_due('2026-09-28T10:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM savings_notifications.events WHERE type='weekly_summary'), 'Opted-in digest for each active goal');
SELECT pg_temp.assert_true((SELECT bool_and(body LIKE '%0.00%') FROM savings_notifications.events WHERE type='weekly_summary'), 'Zero-contribution summary makes no invented earnings claim');
SELECT savings_notifications.generate_due('2026-09-28T11:00:00Z');
SELECT savings_notifications.generate_due('2026-09-29T11:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=6 FROM savings_notifications.events), 'Weekly summary sends once; muted nudges stay off');
SELECT public.update_customer_savings_notification_preferences('11000000-0000-4000-8000-000000000001','{"encouragementEnabled":true}');
SELECT savings_notifications.generate_due('2026-03-01T10:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events WHERE event_key='missed:2026-02-28'), 'Month end clamps from January 31 to February 28');
UPDATE public.customer_savings_goals SET status='paused';
SELECT savings_notifications.generate_due('2026-10-05T10:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM savings_notifications.events WHERE type='weekly_summary'), 'Paused goals do not get weekly or overdue nudges');
UPDATE public.customer_savings_goals SET status='active' WHERE id='44000000-0000-4000-8000-000000000001';
INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,status,processed_at) VALUES
 ('44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',10,'completed','2026-09-27T07:00:00Z');
SELECT savings_notifications.generate_due('2026-09-28T12:00:00Z');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events WHERE goal_id='44000000-0000-4000-8000-000000000001' AND event_key='missed:2026-09-27'), 'Already created nudge is deduplicated after recovery');
SELECT pg_temp.assert_true((SELECT NOT savings_notifications.push_allowed(event,false,'2026-09-28T12:00:00Z') FROM savings_notifications.events event WHERE goal_id='44000000-0000-4000-8000-000000000001' AND event_key='missed:2026-09-27'), 'Recovered contribution suppresses an already queued missed reminder');
SELECT public.update_customer_savings_notification_preferences('11000000-0000-4000-8000-000000000001','{"quietHoursStart":"22:00","quietHoursEnd":"08:00","timeZone":"America/New_York"}');
SELECT pg_temp.assert_true((SELECT NOT savings_notifications.push_allowed(event,true,'2026-11-01T06:30:00Z') FROM savings_notifications.events event WHERE type='first_contribution'), 'Quiet hours handle DST fall-back local time');
SELECT public.update_customer_savings_notification_preferences('11000000-0000-4000-8000-000000000001','{"quietHoursStart":"00:00","quietHoursEnd":"00:00"}');
INSERT INTO public.push_tokens(user_id,merchant_id,token,app_type) VALUES
 ('33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','ExpoPushToken[schedule-test]','storefront');
CREATE TEMP TABLE claims AS SELECT * FROM savings_notifications.claim_push(100);
UPDATE savings_notifications.deliveries SET claimed_at=now()-interval '11 minutes' WHERE status='dispatching';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM savings_notifications.claim_push(100)), 'Crashed push dispatch is not retried');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM savings_notifications.deliveries WHERE status='unknown'), 'Crashed dispatch remains visibly unknown');
ROLLBACK;
