SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.reject($test$
  SELECT piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),'{"policyId":"70000000-0000-4000-8000-000000000212"}'::jsonb)
$test$,'42883');
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),'cancellation',
    '{"policyId":"70000000-0000-4000-8000-000000000212"}'::jsonb)->>'state'='deferred',
  'purchase authority cannot execute through the cancellation action');
RESET SESSION AUTHORIZATION;
ALTER TABLE piggyvest_purchase_preparation.quotes DISABLE TRIGGER quotes_guard;
UPDATE piggyvest_purchase_preparation.quotes
  SET quoted_at=clock_timestamp()-interval '2 seconds', expires_at=clock_timestamp()-interval '1 second'
  WHERE id=goal_policy_test.goal(212);
ALTER TABLE piggyvest_purchase_preparation.quotes ENABLE TRIGGER quotes_guard;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),'purchase',
    '{"policyId":"70000000-0000-4000-8000-000000000212"}'::jsonb)->>'state'='deferred',
  'expired prepared quote cannot submit a transfer');
RESET SESSION AUTHORIZATION;
ALTER TABLE piggyvest_purchase_preparation.quotes DISABLE TRIGGER quotes_guard;
UPDATE piggyvest_purchase_preparation.quotes
  SET quoted_at=clock_timestamp(), expires_at=clock_timestamp()+interval '1 day'
  WHERE id=goal_policy_test.goal(212);
ALTER TABLE piggyvest_purchase_preparation.quotes ENABLE TRIGGER quotes_guard;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),'purchase',
    '{"policyId":"70000000-0000-4000-8000-000000000212"}'::jsonb)->>'state'='submit','begin uses provisioned purchase authority');
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.record_finality('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),
    jsonb_build_object('action','purchase','operationId',goal_policy_test.goal(4212),'reference',goal_policy_test.goal(4212),
      'sourceWalletId','goal-212-wallet','destinationWalletId','merchant-wallet','amountKobo',99150,'currency','NGN','status','unknown'))
    ->>'state'='pending','unknown finality remains verification-only');
SELECT savings_exit_execution_test.reject($test$
  SELECT piggyvest_savings_exit_execution.record_finality('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),
    jsonb_build_object('action','purchase','operationId',goal_policy_test.goal(4212),'reference',goal_policy_test.goal(4212),
      'sourceWalletId','goal-212-wallet','destinationWalletId','merchant-wallet','amountKobo',1,'currency','NGN','status','success'))
$test$,'23505');
BEGIN;
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.record_finality('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),
    jsonb_build_object('action','purchase','operationId',goal_policy_test.goal(4212),'reference',goal_policy_test.goal(4212),
      'sourceWalletId','goal-212-wallet','destinationWalletId','merchant-wallet','amountKobo',99150,'currency','NGN','status','failed'))
    ->>'state'='requires_reconciliation','failed finality creates reconciliation obligation');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(EXISTS(
  SELECT 1 FROM piggyvest_savings_exit_execution.reconciliation_obligations
  WHERE operation_id=goal_policy_test.goal(4212) AND state='requires_release_or_recovery'
),'failed finality is durably obligated before rollback');
SELECT savings_exit_execution_test.assert(NOT EXISTS(
  SELECT 1 FROM piggyvest_savings_ledger.operations WHERE command->>'kind'='settle_reservation'
),'failed finality does not settle or release the reservation');
ROLLBACK;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
BEGIN;
SELECT piggyvest_savings_exit_execution.record_finality('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
  '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),
  jsonb_build_object('action','purchase','operationId',goal_policy_test.goal(4212),'reference',goal_policy_test.goal(4212),
    'sourceWalletId','goal-212-wallet','destinationWalletId','merchant-wallet','amountKobo',99150,'currency','NGN','status','success'));
ROLLBACK;
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_exit_execution.projection_queue),'rollback removes queued projection');
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE command->>'kind'='settle_reservation'),'exit never settles ledger reservation');
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.record_finality('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(212),'synthetic-business',
    '90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4212),
    jsonb_build_object('action','purchase','operationId',goal_policy_test.goal(4212),'reference',goal_policy_test.goal(4212),
      'sourceWalletId','goal-212-wallet','destinationWalletId','merchant-wallet','amountKobo',99150,'currency','NGN','status','success'))
    ->>'state'='pending','unbound provider success remains verification-only');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_exit_execution.projection_queue),'no projection without stored provider evidence');
SELECT savings_exit_execution_test.assert((SELECT state='verify' FROM piggyvest_savings_exit_execution.operations WHERE operation_id=goal_policy_test.goal(4212)),'customer completion is not claimed');
SELECT savings_exit_execution_test.reject('UPDATE piggyvest_savings_exit_execution.operations SET state=''verify''','23514');
SELECT savings_exit_execution_test.reject('DELETE FROM piggyvest_savings_exit_execution.operations','23514');
SELECT savings_exit_execution_test.reject('TRUNCATE piggyvest_savings_exit_execution.operations, piggyvest_savings_exit_execution.projection_queue, piggyvest_savings_exit_execution.reconciliation_obligations','23514');
UPDATE public.customers SET user_id='90000000-0000-4000-8000-000000000002'
  WHERE id='20000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(
  piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',goal_policy_test.goal(213),'synthetic-business',
    '90000000-0000-4000-8000-000000000002',goal_policy_test.goal(4213),'cancellation',
    '{"policyId":"70000000-0000-4000-8000-000000000213"}'::jsonb)->>'state'='deferred',
  'cancellation consent actor cannot execute after customer identity rebind');
RESET SESSION AUTHORIZATION;
UPDATE public.customers SET user_id='90000000-0000-4000-8000-000000000001'
  WHERE id='20000000-0000-4000-8000-000000000001';
