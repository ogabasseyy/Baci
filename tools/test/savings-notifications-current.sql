BEGIN;
CREATE FUNCTION pg_temp.assert_notification(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO public.merchants(id) VALUES ('81000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
 ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001');
INSERT INTO savings_notifications.preferences(merchant_id,customer_id,quiet_hours_start,quiet_hours_end) VALUES
 ('81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','00:00','00:00');
SELECT savings_notifications.emit('84000000-0000-4000-8000-000000000001','current-retry','interest_credited','Fixture interest','Synthetic only');

SELECT pg_temp.assert_notification((SELECT count(*) = 0 FROM savings_notifications.claim_push(1)), 'Tokenless event is not dispatched');
SELECT pg_temp.assert_notification((SELECT push_expanded_at IS NULL AND push_last_attempt_at IS NOT NULL
 FROM savings_notifications.events WHERE event_key='current-retry'), 'Tokenless expansion remains retryable and scheduled');
INSERT INTO public.push_tokens(user_id,merchant_id,token,app_type) VALUES
 ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','ExpoPushToken[current-fixture-only]','storefront');
SELECT pg_temp.assert_notification((SELECT count(*) = 0 FROM savings_notifications.claim_push(1)), 'Tokenless expansion respects its retry delay');
UPDATE savings_notifications.events SET push_last_attempt_at=now()-interval '16 minutes' WHERE event_key='current-retry';
CREATE TEMP TABLE current_claim AS SELECT * FROM savings_notifications.claim_push(1);
SELECT pg_temp.assert_notification((SELECT count(*) = 1 FROM current_claim), 'Later token registration dispatches after expansion backoff');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'retryable',NULL) FROM current_claim;
SELECT pg_temp.assert_notification((SELECT status='pending' AND attempts=1 AND claim_id IS NULL
 AND retry_after > now() AND retry_after <= now()+interval '16 minutes'
 FROM savings_notifications.deliveries), 'Retryable outcome counts the attempt and defers delivery');
SELECT pg_temp.assert_notification((SELECT count(*) = 0 FROM savings_notifications.claim_push(1)), 'Retryable delivery cannot resend in the same worker run');

UPDATE savings_notifications.deliveries SET retry_after=now()-interval '1 minute';
CREATE TEMP TABLE elapsed_claim AS SELECT * FROM savings_notifications.claim_push(1);
SELECT pg_temp.assert_notification((SELECT count(*) = 1 FROM elapsed_claim), 'Delivery is claimable after retry backoff');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'accepted','current-fixture-ticket') FROM elapsed_claim;
SELECT pg_temp.assert_notification((SELECT retry_after IS NULL FROM savings_notifications.deliveries), 'Accepted delivery clears retry backoff');
UPDATE savings_notifications.deliveries SET claimed_at=now()-interval '16 minutes';
SELECT pg_temp.assert_notification((SELECT count(*) = 1 FROM savings_notifications.pending_receipts(1)), 'Accepted delivery enters receipt reconciliation');
SET LOCAL ROLE baci_savings_notifications_worker;
SELECT pg_temp.assert_notification(savings_notifications.requeue_delivery('current-fixture-ticket'), 'Restricted worker can requeue a rate-limited receipt');
RESET ROLE;
SELECT pg_temp.assert_notification((SELECT status='pending' AND attempts=2 AND ticket_id IS NULL AND retry_after IS NULL
 FROM savings_notifications.deliveries), 'Rate-limited receipt schedules a fresh send');

CREATE TEMP TABLE unregistered_claim AS SELECT * FROM savings_notifications.claim_push(1);
SELECT pg_temp.assert_notification((SELECT count(*) = 1 FROM unregistered_claim), 'Receipt requeue can be claimed');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'unregistered',NULL) FROM unregistered_claim;
SELECT pg_temp.assert_notification((SELECT NOT is_active FROM public.push_tokens), 'Unregistered outcome retires the fixture token');
SELECT pg_temp.assert_notification((SELECT status='rejected' FROM savings_notifications.deliveries), 'Unregistered outcome rejects the delivery');
UPDATE public.push_tokens SET is_active=true;
UPDATE savings_notifications.deliveries SET status='pending',attempts=96,retry_after=NULL;
CREATE TEMP TABLE exhausted_claim AS SELECT * FROM savings_notifications.claim_push(1);
SELECT pg_temp.assert_notification((SELECT count(*) = 1 FROM exhausted_claim), 'Exhausted delivery reaches the final outcome check');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'retryable',NULL) FROM exhausted_claim;
SELECT pg_temp.assert_notification((SELECT status='rejected' AND retry_after IS NULL FROM savings_notifications.deliveries), 'Retry cap rejects instead of repeatedly deferring');
SELECT pg_temp.assert_notification((SELECT count(*) = 0 FROM savings_notifications.claim_push(1)), 'Terminal delivery never dispatches again');
ROLLBACK;
