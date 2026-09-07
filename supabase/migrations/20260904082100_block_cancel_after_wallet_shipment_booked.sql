-- Booked wallet charges must block cancellation even after shipment_id is set.
-- Only pre-submission reservation refunds require shipment_id IS NULL.

CREATE OR REPLACE FUNCTION private.prevent_active_gigl_shipping_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  IF NEW.shipping_status IN ('cancelled', 'canceled')
     AND OLD.shipping_status NOT IN ('cancelled', 'canceled') THEN
    IF EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges AS charge
      WHERE charge.order_id = NEW.id
        AND charge.status IN ('booked', 'needs_reconciliation')
    ) THEN
      RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
    END IF;

    IF NEW.shipment_id IS NULL THEN
      IF NEW.shipment_booking_lock_token IS NOT NULL
         AND NEW.shipment_booking_started_at IS NOT NULL
         AND NEW.shipment_booking_started_at > now() - interval '15 minutes' THEN
        RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
      END IF;

      FOR v_charge IN
        SELECT charge.*
        FROM public.merchant_shipping_charges AS charge
        WHERE charge.order_id = NEW.id
          AND charge.status = 'reserved'
          AND charge.shipment_id IS NULL
        FOR UPDATE
      LOOP
        UPDATE public.merchant_wallets
        SET available_balance = available_balance + v_charge.charged_amount,
            updated_at = now()
        WHERE merchant_id = v_charge.merchant_id
        RETURNING available_balance INTO v_balance;

        INSERT INTO public.wallet_transactions(
          wallet_id, merchant_id, type, amount, balance_after, source_type,
          source_id, description, status
        )
        SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
          v_balance, 'gigl_shipping', v_charge.order_id,
          'GIGL shipping reservation refund on cancel', 'completed'
        FROM public.merchant_wallets
        WHERE merchant_id = v_charge.merchant_id
        RETURNING id INTO v_transaction;

        UPDATE public.merchant_shipping_charges
        SET status = 'refunded',
            refund_transaction_id = v_transaction,
            failure_code = 'ORDER_CANCELLED_BEFORE_SUBMISSION',
            refunded_at = now(),
            updated_at = now()
        WHERE id = v_charge.id;
      END LOOP;

      IF EXISTS (
        SELECT 1
        FROM public.merchant_shipping_charges AS charge
        WHERE charge.order_id = NEW.id
          AND (
            (
              charge.shipment_id IS NULL
              AND charge.status IN ('provider_submitting')
            )
            OR charge.status IN ('booked', 'needs_reconciliation')
          )
      ) THEN
        RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
