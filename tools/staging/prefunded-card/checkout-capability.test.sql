BEGIN;

SELECT id AS checkout_treasury_id,integration_id AS checkout_integration_id,
  merchant_id AS checkout_merchant_id,expected_business_id AS checkout_business_id
FROM prefunded_card.treasury_bindings
WHERE authorized_login='prefunded_treasury_operator' AND enabled
\gset
SELECT id AS checkout_customer_id,user_id AS checkout_actor_id
FROM public.customers WHERE email='first-card@example.test'
\gset
SELECT id AS checkout_goal_id
FROM public.customer_savings_goals
WHERE customer_id=:'checkout_customer_id' AND merchant_id=:'checkout_merchant_id'
  AND goal_kind='legacy' AND status='active' AND completed_at IS NULL
LIMIT 1
\gset
SELECT system_identifier::text AS checkout_system_identifier FROM pg_control_system()
\gset

CREATE SCHEMA prefunded_first_card_capability_test;
GRANT USAGE ON SCHEMA prefunded_first_card_capability_test TO PUBLIC;
CREATE FUNCTION prefunded_first_card_capability_test.assert_result(
  p_scope jsonb,p_customer uuid,p_actor uuid,p_goal uuid,p_enabled boolean,p_maximum bigint
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  result:=prefunded_card.checkout_capability(p_scope,p_customer,p_actor,p_goal,10000);
  IF result->'enabled' IS DISTINCT FROM to_jsonb(p_enabled)
    OR (result->>'maximumAmountKobo')::bigint IS DISTINCT FROM p_maximum THEN
    RAISE EXCEPTION 'first-card capability expected enabled %, maximum %, got %',
      p_enabled,p_maximum,result;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION prefunded_first_card_capability_test.assert_result(
  jsonb,uuid,uuid,uuid,boolean,bigint) TO PUBLIC;

SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_first_card_capability_test.assert_result(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  :'checkout_customer_id',:'checkout_actor_id',:'checkout_goal_id',true,10000);
RESET SESSION AUTHORIZATION;

SAVEPOINT saved_method_cases;
INSERT INTO public.customer_saved_payment_methods
  (id,merchant_id,customer_id,provider,reusable,is_active,disabled_at)
VALUES ('60000000-0000-4000-8000-0000000000fc',:'checkout_merchant_id',
  :'checkout_customer_id','paystack',true,false,clock_timestamp());
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_first_card_capability_test.assert_result(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  :'checkout_customer_id',:'checkout_actor_id',:'checkout_goal_id',false,0);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET is_active=true,reusable=false,disabled_at=NULL
WHERE id='60000000-0000-4000-8000-0000000000fc';
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_first_card_capability_test.assert_result(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  :'checkout_customer_id',:'checkout_actor_id',:'checkout_goal_id',false,0);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT saved_method_cases;

SAVEPOINT funding_pending_case;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_card.checkout_reserve(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  jsonb_build_object('customerId',:'checkout_customer_id','actorId',:'checkout_actor_id',
    'goalId',:'checkout_goal_id','amountKobo',10000,
    'idempotencyKey','80000000-0000-4000-8000-0000000000fc',
    'consent',jsonb_build_object('version','prefunded-first-card-v1',
      'oneTimeCharge',true,'saveCard',true)));
RESET SESSION AUTHORIZATION;
SET LOCAL session_replication_role=replica;
UPDATE prefunded_card.checkout_intents SET phase='funding_pending';
SET LOCAL session_replication_role=origin;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_first_card_capability_test.assert_result(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  :'checkout_customer_id',:'checkout_actor_id',:'checkout_goal_id',false,0);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT funding_pending_case;

SAVEPOINT missing_credit_route_case;
SET LOCAL session_replication_role=replica;
DELETE FROM prefunded_card.credit_routes WHERE goal_id=:'checkout_goal_id';
SET LOCAL session_replication_role=origin;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT prefunded_first_card_capability_test.assert_result(
  jsonb_build_object('deployment','staging','integrationId',:'checkout_integration_id',
    'merchantId',:'checkout_merchant_id','treasuryBindingId',:'checkout_treasury_id',
    'businessId',:'checkout_business_id','systemIdentifier',:'checkout_system_identifier',
    'expiresAt','2026-09-29T15:59:10Z'),
  :'checkout_customer_id',:'checkout_actor_id',:'checkout_goal_id',false,0);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT missing_credit_route_case;

ROLLBACK;
