-- Persist ambiguous GIGL wallet shipping charges into the established
-- reconciliation_review queue whenever status becomes needs_reconciliation.

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
    'gigl_wallet_shipping_charge_ambiguous'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

CREATE OR REPLACE FUNCTION private.enqueue_gigl_wallet_shipping_charge_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.status = 'needs_reconciliation'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'needs_reconciliation'
     ) THEN
    INSERT INTO public.reconciliation_review (
      issue_type,
      order_id,
      merchant_id,
      reason,
      metadata
    ) VALUES (
      'gigl_wallet_shipping_charge_ambiguous',
      NEW.order_id,
      NEW.merchant_id,
      'Ambiguous GIGL wallet shipping charge requires review',
      jsonb_build_object(
        'charge_id', NEW.id,
        'failure_code', NEW.failure_code,
        'provider_reference', NEW.provider_reference,
        'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
      )
    )
    ON CONFLICT (issue_type, order_id)
      WHERE resolved_at IS NULL AND order_id IS NOT NULL
      DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_gigl_wallet_shipping_charge_review()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enqueue_gigl_wallet_shipping_charge_review
  ON public.merchant_shipping_charges;
CREATE TRIGGER enqueue_gigl_wallet_shipping_charge_review
  AFTER INSERT OR UPDATE OF status ON public.merchant_shipping_charges
  FOR EACH ROW
  EXECUTE FUNCTION private.enqueue_gigl_wallet_shipping_charge_review();
