SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212)$q$,'42501');
SELECT savings_exit_execution_test.reject($q$INSERT INTO piggyvest_savings_exit_execution.evidence_scopes
  VALUES(gen_random_uuid(),'attacker','piggyvest_exit_evidence_writer',true)$q$,'42501');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.consume(212,'cancellation')$q$,'42501');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION piggyvest_exit_evidence_writer;
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212,'{"amountKobo":1}')$q$,'23514');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212,'{"providerCustomerId":"other"}')$q$,'23514');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212,'{"destinationWalletId":"other"}')$q$,'23514');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212,'{"businessId":"other"}')$q$,'23514');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.store(212)->>'state'='stored','independent purchase evidence stored');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.store(212)->>'state'='stored','exact duplicate no-op');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212,'{"providerTransactionId":"other"}')$q$,'23505');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.store(213)->>'state'='stored','independent refund evidence stored');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.consume(212,'purchase')$q$,'42501');
RESET SESSION AUTHORIZATION;

BEGIN;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='pending_projection','missing economics queues only');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM public.transactions),'missing authority creates no accounting');
ROLLBACK;

INSERT INTO piggyvest_savings_exit_execution.accounting_authorities
  (operation_id,contract,order_id,transaction_id,settlement_id,platform_fee_kobo,merchant_amount_kobo,provider_fee_kobo,approved_terms_reference)
VALUES(goal_policy_test.goal(4212),'purchase_existing_order','80000000-0000-4000-8000-000000000212',
  goal_policy_test.goal(6212),goal_policy_test.goal(7212),50,99100,0,'SYNTHETIC-ONLY-PURCHASE-NOT-OWNER-APPROVAL'),
  (goal_policy_test.goal(4213),'external_principal_refund',NULL,goal_policy_test.goal(6213),goal_policy_test.goal(7213),
  0,0,0,'SYNTHETIC-ONLY-REFUND-NOT-OWNER-APPROVAL');

INSERT INTO savings_exit_execution_test.fail_receipts VALUES(true);
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.consume(212,'purchase')$q$,'23514');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM public.transactions),'transaction rollback');
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE reference_id=goal_policy_test.goal(4212)),'ledger rollback');
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_exit_execution.projection_queue),'queue rollback');
SELECT savings_exit_execution_test.assert((SELECT payment_status='unpaid' AND amount_paid=0 FROM public.orders),'order rollback');
SELECT savings_exit_execution_test.assert((SELECT state='verify' FROM piggyvest_savings_exit_execution.operations WHERE operation_id=goal_policy_test.goal(4212)),'operation rollback');
TRUNCATE savings_exit_execution_test.fail_receipts;

BEGIN;
UPDATE public.orders SET customer_id=NULL;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='pending_projection','wrong order customer cannot project');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM public.transactions),'wrong order creates no accounting');
ROLLBACK;

SELECT savings_exit_execution_test.assert(to_regprocedure('piggyvest_savings_exit_execution.begin(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)') IS NULL,'legacy policy bypass absent');
SELECT savings_exit_execution_test.reject('UPDATE piggyvest_savings_exit_execution.provider_evidence SET receipt=''{}''','23514');
SELECT savings_exit_execution_test.reject('DELETE FROM piggyvest_savings_exit_execution.provider_evidence','23514');
SELECT savings_exit_execution_test.reject('TRUNCATE piggyvest_savings_exit_execution.provider_evidence CASCADE','23514');
