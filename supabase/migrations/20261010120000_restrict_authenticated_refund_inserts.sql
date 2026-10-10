-- Refund rows enter the ledger only through public.manage_order_refund or the
-- service-role worker. An authenticated merchant client could otherwise insert
-- a completed refund directly; the SECURITY INVOKER sync trigger would then
-- fail writing order_refund_events (no authenticated write privilege) and
-- roll the insert back with a confusing privilege error. Reject refund
-- inserts at the policy so the boundary is explicit. ALTER POLICY replaces
-- the whole WITH CHECK, so the same-merchant order-linkage guard from
-- 20260702023000_harden_record_payment_transactions.sql is preserved
-- verbatim alongside the refund exclusion. The sync trigger stays INVOKER
-- on purpose: definer rights would let an unvalidated authenticated row
-- commit.
ALTER POLICY transactions_insert_policy ON public.transactions
  WITH CHECK (
    public.has_merchant_access(merchant_id)
    AND transaction_type <> 'refund'
    AND (
      order_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.orders AS o
        WHERE o.id = transactions.order_id
          AND o.merchant_id = transactions.merchant_id
      )
    )
  );
