-- Preserve the source account while an allocated top-up can still require a
-- cancellation return. Once canceled or fulfillment starts, no future claim can
-- depend on that active-account binding; an open claim still blocks rotation.
CREATE OR REPLACE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id AND (
    EXISTS (
      SELECT 1 FROM private.paid_order_offline_disbursements claim
      JOIN public.orders claim_order ON claim_order.id = claim.order_id
      WHERE claim_order.merchant_id = OLD.merchant_id
        AND claim.account_id = OLD.bank_account_id
        AND claim.evidence_id IS NULL
    ) OR EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence entry
      WHERE entry.merchant_id = OLD.merchant_id
        AND entry.account_id = OLD.bank_account_id
        AND entry.direction = 'incoming'
        AND ((entry.bound_order_id IS NOT NULL AND entry.allocation IS NULL)
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'unapplied')
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'top_up'
            AND EXISTS (
              SELECT 1 FROM public.orders o
              WHERE o.id = entry.order_id AND o.cancelled_at IS NULL
                AND o.shipping_status IN ('pending','processing')
                AND o.shipment_id IS NULL AND o.tracking_number IS NULL
                AND o.shipment_booking_lock_token IS NULL
            )))
    )
  ) THEN
    RAISE EXCEPTION 'bank_return_claim_open';
  END IF;
  RETURN NEW;
END;
$$;
