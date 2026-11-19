-- A matching wallet ledger alone cannot authorize another gateway attempt.
-- Apply the existing payment-transaction fence before the idempotent return.
DO $$
DECLARE
 definition text := pg_get_functiondef('public.record_order_store_credit(uuid)'::regprocedure);
 replay_guard text := ' IF coalesce(o.amount_paid,0)=wallet+savings';
 transaction_guard text := ' OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id=o.id AND t.transaction_type=''payment'')';
BEGIN
 IF (length(definition)-length(replace(definition,replay_guard,'')))/length(replay_guard)<>1
 OR (length(definition)-length(replace(definition,transaction_guard,'')))/length(transaction_guard)<>1 THEN
  RAISE EXCEPTION 'Unexpected store credit replay transaction guard';
 END IF;
 definition := replace(definition,transaction_guard,'');
 EXECUTE replace(definition,replay_guard,$guard$
 IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id=o.id AND t.transaction_type='payment') THEN
  RAISE EXCEPTION 'Store credit reconciliation required' USING ERRCODE='23514';
 END IF;
$guard$ || replay_guard);
END $$;
