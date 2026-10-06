BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id,email) VALUES ('92000000-0000-4000-8000-000000000001','backoff-probe@example.com');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('92000000-0000-4000-8000-000000000007','92000000-0000-4000-8000-000000000001','Probe device',100000,'active',3);
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,source_mode,target_amount) VALUES
  ('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000007','Probe goal','manual',100000);
INSERT INTO savings_notifications.preferences(merchant_id,customer_id,quiet_hours_start,quiet_hours_end) VALUES
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','00:00','00:00');
INSERT INTO savings_notifications.events(merchant_id,customer_id,goal_id,event_key,type,title,body) VALUES
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000004','backoff-probe','interest_credited','Interest','Body');
INSERT INTO public.push_tokens(token,user_id,merchant_id,platform,app_type,is_active) VALUES
  ('ExponentPushToken[backoffprobe]','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','ios','storefront',true);
CREATE TEMP TABLE probe_claim AS SELECT * FROM savings_notifications.claim_push(50);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM probe_claim), 'Claim dispatches the delivery');
SELECT pg_temp.assert_true((SELECT retry_after IS NULL FROM savings_notifications.deliveries WHERE notification_id = (SELECT notification_id FROM probe_claim)), 'Claim clears any backoff stamp');
SELECT savings_notifications.finish_push(notification_id, push_token, claim_id, 'retryable', NULL) FROM probe_claim;
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempts = 1 AND retry_after > now() AND retry_after <= now() + interval '16 minutes' FROM savings_notifications.deliveries WHERE notification_id = (SELECT notification_id FROM probe_claim)), 'Retryable finish defers 15 minutes and counts the attempt');
CREATE TEMP TABLE probe_immediate AS SELECT * FROM savings_notifications.claim_push(50);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM probe_immediate), 'Deferred delivery is excluded from the same run');
UPDATE savings_notifications.deliveries SET retry_after = now() - interval '1 minute' WHERE notification_id = (SELECT notification_id FROM probe_claim);
CREATE TEMP TABLE probe_elapsed AS SELECT * FROM savings_notifications.claim_push(50);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM probe_elapsed), 'Delivery becomes claimable after the backoff elapses');
SELECT savings_notifications.finish_push(notification_id, push_token, claim_id, 'accepted', 'ticket-backoff-1') FROM probe_elapsed;
SELECT pg_temp.assert_true((SELECT retry_after IS NULL FROM savings_notifications.deliveries WHERE ticket_id = 'ticket-backoff-1'), 'Accept clears the backoff stamp');
UPDATE savings_notifications.deliveries SET attempts = 96, status = 'pending', retry_after = NULL, ticket_id = NULL WHERE ticket_id = 'ticket-backoff-1';
CREATE TEMP TABLE probe_cap AS SELECT * FROM savings_notifications.claim_push(50);
SELECT savings_notifications.finish_push(notification_id, push_token, claim_id, 'retryable', NULL) FROM probe_cap;
SELECT pg_temp.assert_true((SELECT status = 'rejected' FROM savings_notifications.deliveries WHERE notification_id = (SELECT notification_id FROM probe_cap)), 'Attempt cap still dead-letters instead of deferring');
ROLLBACK;
