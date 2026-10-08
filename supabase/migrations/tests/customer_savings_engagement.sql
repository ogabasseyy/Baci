BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.get_customer_savings_earnings(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Savings earnings must have an authenticated, principal-independent read';
  END IF;
  IF to_regprocedure('savings_notifications.claim_push(integer)') IS NULL THEN
    RAISE EXCEPTION 'Savings notifications require a durable claim before push dispatch';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id) VALUES ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_true(public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000001') = '{"credited_interest_kobo":0}', 'Principal must never masquerade as earned interest');
SELECT pg_temp.assert_true(public.get_customer_savings_notifications('10000000-0000-4000-8000-000000000001')->'notifications' = '[]', 'Empty inbox');
SELECT pg_temp.assert_true((public.get_customer_savings_notifications('10000000-0000-4000-8000-000000000001')->'preferences'->>'weeklySummaryEnabled')::boolean = false, 'Weekly summary is opt-in');
INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount) VALUES
 ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM savings_notifications.events), 'Pending contributions never celebrate');
UPDATE public.customer_savings_contributions SET status='completed',processed_at=now() WHERE id='50000000-0000-4000-8000-000000000001';
UPDATE public.customer_savings_contributions SET status='completed' WHERE id='50000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM savings_notifications.events WHERE type='first_contribution'), 'First completed contribution emits once');
INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,status,processed_at) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',200,'completed',now());
INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,status,processed_at) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',500,'completed',now());
INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,status,processed_at) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',200,'completed',now());
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM savings_notifications.events WHERE event_key='milestone:100'), 'Completion emits once');
SELECT pg_temp.assert_true((SELECT body LIKE '%80% towards%' AND body LIKE '%20% left%' FROM savings_notifications.events WHERE event_key='milestone:75'), 'Milestone message shows actual progress after a threshold jump');
SELECT pg_temp.assert_true((SELECT count(*) <= 4 FROM savings_notifications.events), 'A threshold jump never floods every milestone');
SELECT pg_temp.assert_true(public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000001') = '{"credited_interest_kobo":0}', 'Savings contributions are not interest');
INSERT INTO piggyvest_staging.integrations(id) VALUES ('60000000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled) VALUES
 ('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','postgres',true);
INSERT INTO piggyvest_savings_ledger.operations(id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id) VALUES
 ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','{"kind":"record_pending_interest","interestKobo":20000}','pending'),
 ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','{"kind":"credit_eligible_paid_interest","interestKobo":15000}','credited');
INSERT INTO piggyvest_savings_ledger.postings(operation_id,account,amount_kobo) VALUES
 ('70000000-0000-4000-8000-000000000001','pending_interest',20000),('70000000-0000-4000-8000-000000000002','paid_interest',15000);
SELECT pg_temp.assert_true(public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000001') = '{"credited_interest_kobo":15000}', 'Only customer credited interest counts');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM savings_notifications.events WHERE type='interest_credited'), 'Accrual never sends earned money notification');
SELECT pg_temp.assert_true((SELECT body LIKE '%150.00%' FROM savings_notifications.events WHERE type='interest_credited'), 'Interest copy converts kobo exactly once');
SELECT public.update_customer_savings_notification_preferences('10000000-0000-4000-8000-000000000001','{"quietHoursStart":"00:00","quietHoursEnd":"00:00"}');
INSERT INTO public.push_tokens(user_id,merchant_id,token,app_type) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ExpoPushToken[customer-one]','storefront'),
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','ExpoPushToken[wrong-merchant]','storefront'),
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ExpoPushToken[admin]','admin');
CREATE TEMP TABLE claims AS SELECT * FROM savings_notifications.claim_push(100);
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM claims), 'One encouragement plus interest; daily push cap');
SELECT pg_temp.assert_true((SELECT bool_and(push_token='ExpoPushToken[customer-one]') FROM claims), 'Push recipient merchant and app type scoped');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM savings_notifications.claim_push(100)), 'No duplicate dispatch on rerun');
SELECT pg_temp.assert_true((SELECT savings_notifications.finish_push(notification_id,push_token,gen_random_uuid(),'accepted','wrong') = false FROM claims LIMIT 1), 'Wrong claim cannot complete delivery');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'accepted','ticket-' || notification_id) FROM claims;
UPDATE savings_notifications.deliveries SET claimed_at=now()-interval '16 minutes' WHERE status='accepted';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM savings_notifications.pending_receipts(100)), 'Accepted tickets enter receipt reconciliation');
SELECT savings_notifications.record_receipt('ticket-' || notification_id,'receipt_failed','DeviceNotRegistered') FROM claims LIMIT 1;
SELECT pg_temp.assert_true((SELECT NOT is_active FROM public.push_tokens WHERE token='ExpoPushToken[customer-one]'), 'Unregistered storefront token disabled');
SELECT pg_temp.assert_true((SELECT is_active FROM public.push_tokens WHERE token='ExpoPushToken[wrong-merchant]'), 'Receipt never disables another merchant token');
SELECT public.update_customer_savings_notification_preferences('10000000-0000-4000-8000-000000000001','{"encouragementEnabled":false,"quietHoursStart":"22:00","quietHoursEnd":"08:00"}');
SELECT pg_temp.assert_true((SELECT NOT savings_notifications.push_allowed(event,true,'2026-09-25T23:00:00Z') FROM savings_notifications.events event WHERE type='interest_credited'), 'Overnight quiet hours defer interest pushes');
SELECT pg_temp.assert_true((SELECT savings_notifications.push_allowed(event,true,'2026-09-25T10:00:00Z') FROM savings_notifications.events event WHERE type='interest_credited'), 'Quiet hours end permits interest alerts');
SELECT pg_temp.assert_true((SELECT NOT savings_notifications.push_allowed(event,false) FROM savings_notifications.events event WHERE type='first_contribution'), 'Encouragement can be muted independently');
INSERT INTO piggyvest_savings_ledger.operations(id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id,reference_id) VALUES
 ('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','{"kind":"reverse_credit","interestKobo":0}','reversed','70000000-0000-4000-8000-000000000002');
INSERT INTO piggyvest_savings_ledger.postings(operation_id,account,amount_kobo) VALUES ('70000000-0000-4000-8000-000000000003','paid_interest',-15000);
SELECT pg_temp.assert_true(public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000001') = '{"credited_interest_kobo":0}', 'Reversed interest removed from earnings');
SELECT pg_temp.assert_true((SELECT voided_at IS NOT NULL FROM savings_notifications.events WHERE type='interest_credited'), 'Reversal voids stale earned-interest claim');
SELECT pg_temp.assert_true(public.mark_customer_savings_notification_read('10000000-0000-4000-8000-000000000001',(SELECT id FROM savings_notifications.events WHERE type='first_contribution')), 'Read status persists');
DO $$ BEGIN
  BEGIN PERFORM public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'Cross-merchant access allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.update_customer_savings_notification_preferences('10000000-0000-4000-8000-000000000001','{"timeZone":"Bad/Zone"}'); RAISE EXCEPTION 'Invalid zone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000001') = '{"credited_interest_kobo":0}', 'Authenticated caller can read only scoped earnings');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','savings_notifications.claim_push(integer)','execute'), 'Customer cannot claim push queue');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','savings_notifications.events','insert'), 'Customer cannot forge financial notifications');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_customer_savings_notifications(uuid)','execute'), 'Anonymous denied');
SELECT pg_temp.assert_true(has_function_privilege('baci_savings_notifications_worker','savings_notifications.claim_push(integer)','execute'), 'Restricted worker has exact claim RPC grant');
SELECT pg_temp.assert_true(NOT has_table_privilege('baci_savings_notifications_worker','savings_notifications.events','select'), 'Worker cannot browse customer inboxes directly');
UPDATE public.customers SET deleted_at=now() WHERE id='20000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN PERFORM public.get_customer_savings_notifications('10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'Deleted customer was authorized';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.customers SET deleted_at=NULL WHERE id='20000000-0000-4000-8000-000000000001';
INSERT INTO savings_notifications.preferences(merchant_id,customer_id) VALUES
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
DELETE FROM public.customers WHERE id='20000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM savings_notifications.preferences WHERE customer_id='20000000-0000-4000-8000-000000000002'), 'Preferences do not block customer deletion');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
SELECT savings_notifications.emit('40000000-0000-4000-8000-000000000003','first-contribution','first_contribution','First contribution','Saved');
INSERT INTO savings_notifications.deliveries(notification_id,push_token)
 SELECT id,'ExpoPushToken[deleted-goal]' FROM savings_notifications.events WHERE goal_id='40000000-0000-4000-8000-000000000003';
DELETE FROM public.customer_savings_goals WHERE id='40000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM savings_notifications.deliveries WHERE push_token='ExpoPushToken[deleted-goal]'), 'Goal deletion clears its notification and deliveries');
SELECT public.update_customer_savings_notification_preferences('10000000-0000-4000-8000-000000000001','{"quietHoursStart":"00:00","quietHoursEnd":"00:00"}');
SELECT savings_notifications.emit('40000000-0000-4000-8000-000000000001','retry-probe','interest_credited','Interest','Paid');
INSERT INTO public.push_tokens(user_id,merchant_id,token,app_type) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ExpoPushToken[retry-probe]','storefront');
CREATE TEMP TABLE retry_claim AS SELECT * FROM savings_notifications.claim_push(100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM retry_claim WHERE push_token='ExpoPushToken[retry-probe]'), 'Retry probe claimed');
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'retryable',NULL) FROM retry_claim WHERE push_token='ExpoPushToken[retry-probe]';
SELECT pg_temp.assert_true((SELECT status='pending' AND attempts=1 AND claim_id IS NULL FROM savings_notifications.deliveries WHERE push_token='ExpoPushToken[retry-probe]'), 'Retryable re-queues as pending');
UPDATE savings_notifications.deliveries SET attempts=96 WHERE push_token='ExpoPushToken[retry-probe]';
CREATE TEMP TABLE retry_claim2 AS SELECT * FROM savings_notifications.claim_push(100);
SELECT savings_notifications.finish_push(notification_id,push_token,claim_id,'retryable',NULL) FROM retry_claim2 WHERE push_token='ExpoPushToken[retry-probe]';
SELECT pg_temp.assert_true((SELECT status='rejected' FROM savings_notifications.deliveries WHERE push_token='ExpoPushToken[retry-probe]'), 'Exhausted retries dead-letter as rejected');
ROLLBACK;
