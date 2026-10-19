-- Allow durable review rows for verified short captures on partially paid
-- orders: the provider captured less than the outstanding balance, so the
-- sweep files the capture for operations and retires the attempt instead of
-- rotating the same hold forever. A short capture describes one captured
-- transfer, so it deduplicates per transfer (txn/ref) like the other
-- captured-payment review types — not per order.

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
    'wallet_dva_order_payment_replay',
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
    'merchant_invoice_partial_payment_conflict',
    'merchant_wallet_assignment_review',
    'gigl_wallet_shipping_charge_ambiguous',
    'shipment_booked_after_full_refund',
    'duplicate_payment_capture_requires_review',
    'abandoned_attempt_evidence_mismatch',
    'provider_refund_outside_cancellation',
    'order_cancellation_over_refund_requires_review',
    'partial_capture_short_requires_review'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

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
      'merchant_invoice_partial_payment_conflict',
      'partial_capture_short_requires_review'
    );
