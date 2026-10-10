-- Refund rows enter the ledger only through public.manage_order_refund or the
-- service-role worker. An authenticated merchant client could otherwise insert
-- a completed refund directly; the SECURITY INVOKER sync trigger would then
-- fail writing order_refund_events (no authenticated write privilege) and
-- roll the insert back with a confusing privilege error. Reject refund
-- inserts at the policy so the boundary is explicit. The sync trigger stays
-- INVOKER on purpose: definer rights would let an unvalidated authenticated
-- row commit.
ALTER POLICY transactions_insert_policy ON public.transactions
  WITH CHECK (
    public.has_merchant_access(merchant_id)
    AND transaction_type <> 'refund'
  );
