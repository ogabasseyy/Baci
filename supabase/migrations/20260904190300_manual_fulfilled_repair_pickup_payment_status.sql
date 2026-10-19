-- Distinguish merchant manual pickup arrangement from payment-review.
-- manual_fulfilled is terminal for GIGL booking and webhook rebooking;
-- review remains bookable from the dashboard after a payment-side review.

ALTER TABLE public.repairs
  DROP CONSTRAINT IF EXISTS repairs_pickup_payment_status_check;
ALTER TABLE public.repairs
  ADD CONSTRAINT repairs_pickup_payment_status_check CHECK (
    pickup_payment_status IS NULL
    OR pickup_payment_status IN (
      'awaiting_payment',
      'paid',
      'booking',
      'booked',
      'retrying',
      'review',
      'manual_fulfilled'
    )
  );

COMMENT ON CONSTRAINT repairs_pickup_payment_status_check ON public.repairs IS
  'Pickup payment lifecycle; manual_fulfilled means merchant arranged logistics offline and GIGL must not book.';
