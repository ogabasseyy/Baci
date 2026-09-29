-- Allow durable review rows for provider-verified refunds on orders that
-- are not cancelled (e.g. a dashboard-issued refund): the cancellation
-- recovery path cannot record them, but acknowledging without a trace
-- would leave the order paid and fulfillable after the customer was
-- refunded. Each provider refund files its own row, deduped by
-- paystack_ref: redelivery of the same refund conflicts and reads as
-- already filed, while a second refund on the same order files anew.

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
    'provider_refund_outside_cancellation'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

-- A provider refund outside cancellation describes one refund transfer.
-- Keep order_id for navigation while deduplicating independently by
-- paystack_ref, like the other captured-payment review types.
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
      'provider_refund_outside_cancellation'
    );
