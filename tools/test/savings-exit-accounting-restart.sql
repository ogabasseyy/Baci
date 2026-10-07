SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='accounted','purchase restart replay');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(213,'cancellation')->>'state'='accounted','refund independent receipt recovered');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(213,'cancellation')->>'state'='accounted','refund duplicate no-op');
RESET SESSION AUTHORIZATION;
SELECT savings_exit_execution_test.assert((SELECT count(*)=2 FROM public.transactions),'exactly two public account transactions');
SELECT savings_exit_execution_test.assert((SELECT count(*)=2 FROM piggyvest_savings_exit_execution.accounting_receipts),'exactly two queue consumptions');
SELECT savings_exit_execution_test.assert((SELECT count(*)=2 FROM piggyvest_savings_ledger.operations WHERE command->>'kind'='settle_reservation'),'exactly two ledger settlements');
SELECT savings_exit_execution_test.assert((SELECT payment_status='paid' AND amount_paid=991.50 AND payment_method='savings' FROM public.orders),'real order paid exactly');
SELECT savings_exit_execution_test.assert((SELECT transaction_type='refund' AND amount=1 AND order_id IS NULL AND merchant_amount=0
  FROM public.transactions WHERE id=goal_policy_test.goal(6213)),'real external refund journal without ordinary-wallet double credit');
SELECT savings_exit_execution_test.assert((SELECT transaction_type='payment' AND amount=991.50 AND platform_fee=0.50 AND merchant_amount=991
  FROM public.transactions WHERE id=goal_policy_test.goal(6212)),'explicit purchase economics');
SELECT savings_exit_execution_test.assert(NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.postings
  WHERE operation_id IN (goal_policy_test.goal(7212),goal_policy_test.goal(7213)) AND account IN ('paid_interest','pending_interest')),'retained interest untouched');
SELECT savings_exit_execution_test.reject('DELETE FROM piggyvest_savings_exit_execution.accounting_receipts','23514');
SELECT savings_exit_execution_test.reject('TRUNCATE piggyvest_savings_exit_execution.accounting_receipts','23514');
