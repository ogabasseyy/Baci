-- Record verified Paystack underpayments against merchant-created invoices
-- without advancing fulfillment or pretending the invoice is fully paid.

ALTER TABLE public.reconciliation_review
  DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check;

ALTER TABLE public.reconciliation_review
  ADD CONSTRAINT reconciliation_review_issue_type_check CHECK (issue_type IN (
    'payment_match_ambiguous',
    'payment_match_zero_candidates',
    'manage_stock_cancellation_held',
    'tax_basis_unclassified',
    'tax_basis_inconsistent_total',
    'wallet_dva_order_alias_conflict',
    'customer_savings_auto_debit_allocation_failed',
    'wallet_order_funding_ambiguous',
    'wallet_order_funding_conflict',
    'wallet_order_funding_finalize_failed',
    'payment_received_after_cancellation',
    'payment_received_after_refund',
    'serialized_inventory_confirmation_failed',
    'merchant_settlement_failed',
    'gateway_payment_wedge_requires_review',
    'credit_direct_confirmation_missing',
    'order_cancellation_refund_requires_review',
    'paypal_capture_persist_failed',
    'merchant_invoice_partial_payment_conflict'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

-- A partial-payment conflict describes one captured transfer. Keep order_id
-- for navigation while deduplicating independently by txn/ref, like the other
-- captured-payment review types.
DROP INDEX IF EXISTS public.reconciliation_review_open_by_order_idx;

CREATE UNIQUE INDEX reconciliation_review_open_by_order_idx
  ON public.reconciliation_review (issue_type, order_id)
  WHERE resolved_at IS NULL
    AND order_id IS NOT NULL
    AND issue_type NOT IN (
      'payment_received_after_cancellation',
      'payment_received_after_refund',
      'merchant_settlement_failed',
      'gateway_payment_wedge_requires_review',
      'merchant_invoice_partial_payment_conflict'
    );
