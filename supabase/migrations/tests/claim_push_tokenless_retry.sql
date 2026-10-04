BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id) VALUES ('90000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
  ('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002');
INSERT INTO savings_notifications.preferences(merchant_id,customer_id,quiet_hours_start,quiet_hours_end) VALUES
  ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','00:00','00:00');
INSERT INTO savings_notifications.events(merchant_id,customer_id,goal_id,event_key,type,title,body) VALUES
  ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000004','tokenless-probe','interest_credited','Interest','Body');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM savings_notifications.claim_push(50)), 'Tokenless claim dispatches nothing');
SELECT pg_temp.assert_true((SELECT push_expanded_at IS NULL FROM savings_notifications.events WHERE event_key='tokenless-probe'), 'Tokenless event stays unexpanded');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM savings_notifications.deliveries), 'Tokenless claim inserts no deliveries');
INSERT INTO public.push_tokens(token,user_id,merchant_id,platform,app_type,is_active) VALUES
  ('ExponentPushToken[tokenlessprobe]','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','ios','storefront',true);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM savings_notifications.claim_push(50)), 'Late token receives the pending notification');
SELECT pg_temp.assert_true((SELECT push_expanded_at IS NOT NULL FROM savings_notifications.events WHERE event_key='tokenless-probe'), 'Delivered event expands');
ROLLBACK;
