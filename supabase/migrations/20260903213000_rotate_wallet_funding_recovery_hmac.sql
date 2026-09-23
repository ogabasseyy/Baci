-- Rotate the repository-visible funding-recovery HMAC seed and allow the
-- wallet DVA order-payment replay review type.

UPDATE private.merchant_wallet_funding_recovery_secrets
SET secret = encode(extensions.gen_random_bytes(32), 'hex')
WHERE name = 'funding_recovery_v1'
  AND secret = 'baci-merchant-wallet-funding-recovery-hmac-v1';

INSERT INTO private.merchant_wallet_funding_recovery_secrets (name, secret)
SELECT
  'funding_recovery_v1',
  encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (
  SELECT 1
  FROM private.merchant_wallet_funding_recovery_secrets
  WHERE name = 'funding_recovery_v1'
);

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
    'merchant_invoice_partial_payment_conflict'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;
