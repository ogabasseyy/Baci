\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-completion.integration.sql
ALTER TABLE public.customers ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN title text NOT NULL DEFAULT 'Fixture device';
\ir ../../../../../supabase/migrations/20260925130000_customer_savings_engagement_storage.sql
\ir ../../../../../supabase/migrations/20260925130100_customer_savings_engagement_events.sql
\if :{?without_primary_notifications}
\else
\ir ../../../../../supabase/migrations/20261007212000_piggyvest_primary_completion_notifications.sql
\endif

INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
VALUES(pg_temp.goal_id(21),'00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','active',130,100);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(21),id,'notification-wallet',true FROM piggyvest_primary.onboarding_intents;
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
VALUES(pg_temp.goal_id(21),'10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','primary_interest_fixture',true);

SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(21,pg_temp.command(301,'credit_eligible_paid_interest',3000));
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(21) AND event_key='milestone:100' AND type='goal_completed' AND voided_at IS NULL),
  'Interest-only completion must enqueue exactly one goal completion');
UPDATE public.customer_savings_goals SET status=status WHERE id=pg_temp.goal_id(21);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(21) AND event_key='milestone:100'),'Status refresh must not duplicate completion');
SELECT pg_temp.assert_true((SELECT current_amount=100 AND status='completed' FROM public.customer_savings_goals
  WHERE id=pg_temp.goal_id(21)),'Interest notification must not duplicate principal');

SET SESSION AUTHORIZATION primary_interest_fixture;
SELECT pg_temp.apply_interest(21,pg_temp.command(302,'reverse_credit',0,pg_temp.goal_id(301)));
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT voided_at IS NOT NULL FROM savings_notifications.events
  WHERE goal_id=pg_temp.goal_id(21) AND event_key='milestone:100'),'Reversed completion must not remain deliverable');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','piggyvest_primary.notify_funded_goal()','EXECUTE'),
  'Customers cannot call the notification trigger');
SELECT 'PRIMARY completion notification regressions passed' AS result;
