BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
INSERT INTO public.merchants(id) VALUES ('91000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
  ('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');
INSERT INTO savings_notifications.events(id,merchant_id,customer_id,goal_id,event_key,type,title,body) VALUES
  ('91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','unregistered-probe','interest_credited','Interest','Body'),
  ('91000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004','rejected-probe','interest_credited','Interest','Body');
INSERT INTO public.push_tokens(token,user_id,merchant_id,platform,app_type,is_active) VALUES
  ('ExponentPushToken[deadbeef]','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000001','ios','storefront',true),
  ('ExponentPushToken[livebeef]','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000001','ios','storefront',true);
INSERT INTO savings_notifications.deliveries(notification_id,push_token,status,claim_id) VALUES
  ('91000000-0000-4000-8000-000000000005','ExponentPushToken[deadbeef]','dispatching','92000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000006','ExponentPushToken[livebeef]','dispatching','92000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_true(
  (SELECT savings_notifications.finish_push('91000000-0000-4000-8000-000000000005','ExponentPushToken[deadbeef]','92000000-0000-4000-8000-000000000001','unregistered',NULL)),
  'Unregistered finish returns true'
);
SELECT pg_temp.assert_true(
  (SELECT status = 'rejected' FROM savings_notifications.deliveries WHERE notification_id = '91000000-0000-4000-8000-000000000005'),
  'Unregistered delivery records as rejected'
);
SELECT pg_temp.assert_true(
  (SELECT NOT is_active FROM public.push_tokens WHERE token = 'ExponentPushToken[deadbeef]'),
  'Unregistered token is deactivated'
);
SELECT pg_temp.assert_true(
  (SELECT savings_notifications.finish_push('91000000-0000-4000-8000-000000000006','ExponentPushToken[livebeef]','92000000-0000-4000-8000-000000000002','rejected',NULL)),
  'Plain rejected finish returns true'
);
SELECT pg_temp.assert_true(
  (SELECT is_active FROM public.push_tokens WHERE token = 'ExponentPushToken[livebeef]'),
  'Plain rejected finish leaves other tokens active'
);
ROLLBACK;
