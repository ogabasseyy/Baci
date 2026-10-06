BEGIN;
INSERT INTO public.merchants(id) VALUES ('12000000-0000-4000-8000-000000000001');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
 ('23000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id) VALUES
 ('45000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001');
INSERT INTO savings_notifications.preferences(merchant_id,customer_id,quiet_hours_start,quiet_hours_end) VALUES
 ('12000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','00:00','00:00');
INSERT INTO public.push_tokens(user_id,merchant_id,token,app_type) VALUES
 ('34000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','ExpoPushToken[race-test]','storefront');
SELECT savings_notifications.emit('45000000-0000-4000-8000-000000000001','first-contribution','first_contribution','First contribution','Confirmed contribution');
SELECT savings_notifications.emit('45000000-0000-4000-8000-000000000001','milestone:25','milestone','Milestone','25% saved');
SELECT savings_notifications.emit('45000000-0000-4000-8000-000000000001','milestone:50','milestone','Milestone','50% saved');
INSERT INTO savings_notifications.deliveries(notification_id,push_token)
 SELECT id,'ExpoPushToken[race-test]' FROM savings_notifications.events;
UPDATE savings_notifications.events SET push_expanded_at=now();
COMMIT;
