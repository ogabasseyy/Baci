-- Keep the reason a shipment booking failed, so a stuck order can be diagnosed
-- from the database instead of from Vercel logs that expire.
CREATE TABLE IF NOT EXISTS public.order_shipment_booking_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  error_code text NOT NULL CHECK (char_length(error_code) <= 64),
  error_message text NOT NULL CHECK (char_length(error_message) <= 500),
  http_status integer,
  -- not_submitted: the provider was never reached, so retrying is safe.
  -- provider_unconfirmed: the request may have reached the provider; the
  --   order stays locked briefly to avoid booking the parcel twice.
  -- rejected: the provider or our checks refused the booking.
  -- booked_not_saved: the provider booked the parcel but saving it here failed.
  -- unexpected: an error that is not a provider answer (a bug or database fault).
  outcome text NOT NULL CHECK (
    outcome IN ('not_submitted', 'provider_unconfirmed', 'rejected', 'booked_not_saved', 'unexpected')
  ),
  lock_retained boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_shipment_booking_failures_order_idx
  ON public.order_shipment_booking_failures (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_shipment_booking_failures_merchant_idx
  ON public.order_shipment_booking_failures (merchant_id);

ALTER TABLE public.order_shipment_booking_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_shipment_booking_failures FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.order_shipment_booking_failures TO authenticated;

CREATE POLICY "merchant_staff_read_booking_failures"
  ON public.order_shipment_booking_failures
  FOR SELECT TO authenticated
  USING (public.has_merchant_access(merchant_id));

CREATE POLICY "merchant_staff_record_booking_failures"
  ON public.order_shipment_booking_failures
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_merchant_access(merchant_id)
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND o.merchant_id = order_shipment_booking_failures.merchant_id
    )
  );
