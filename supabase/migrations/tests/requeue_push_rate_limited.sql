BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id,email) VALUES ('91000000-0000-4000-8000-000000000001','requeue-probe@example.com');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('91000000-0000-4000-8000-000000000007','91000000-0000-4000-8000-000000000001','Probe device',100000,'active',3);
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,source_mode,target_amount) VALUES
  ('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000007','Probe goal','manual',100000);
INSERT INTO savings_notifications.preferences(merchant_id,customer_id,quiet_hours_start,quiet_hours_end) VALUES
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','00:00','00:00');
INSERT INTO savings_notifications.events(merchant_id,customer_id,goal_id,event_key,type,title,body) VALUES
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','requeue-probe','interest_credited','Interest','Body');
INSERT INTO public.push_tokens(token,user_id,merchant_id,platform,app_type,is_active) VALUES
  ('ExponentPushToken[requeueprobe]','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000001','ios','storefront',true);
CREATE TEMP TABLE probe_claim AS SELECT * FROM savings_notifications.claim_push(50);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM probe_claim), 'Claim dispatches the delivery');
SELECT savings_notifications.finish_push(notification_id, push_token, claim_id, 'accepted', 'ticket-requeue-1') FROM probe_claim;
SELECT pg_temp.assert_true(savings_notifications.requeue_delivery('ticket-requeue-1'), 'Rate-limited ticket requeues');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND ticket_id IS NULL AND attempts = 1 AND receipt_error = 'MessageRateExceeded' FROM savings_notifications.deliveries WHERE notification_id = (SELECT notification_id FROM probe_claim)), 'Requeued delivery returns to pending');
SELECT pg_temp.assert_true((SELECT savings_notifications.requeue_delivery('ticket-requeue-1') IS NOT DISTINCT FROM false), 'Requeue is idempotent once pending');
SELECT pg_temp.assert_true((SELECT savings_notifications.requeue_delivery('ticket-missing') IS NOT DISTINCT FROM false), 'Unknown ticket requeues nothing');
CREATE TEMP TABLE probe_reclaim AS SELECT * FROM savings_notifications.claim_push(50);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM probe_reclaim), 'Requeued delivery resends on the next claim');
SELECT savings_notifications.finish_push(notification_id, push_token, claim_id, 'accepted', 'ticket-requeue-2') FROM probe_reclaim;
UPDATE savings_notifications.deliveries SET attempts = 96 WHERE ticket_id = 'ticket-requeue-2';
SELECT pg_temp.assert_true(savings_notifications.requeue_delivery('ticket-requeue-2'), 'Capped ticket still resolves');
SELECT pg_temp.assert_true((SELECT status = 'receipt_unknown' FROM savings_notifications.deliveries WHERE ticket_id = 'ticket-requeue-2'), 'Attempt cap dead-letters as receipt_unknown');
ROLLBACK;
