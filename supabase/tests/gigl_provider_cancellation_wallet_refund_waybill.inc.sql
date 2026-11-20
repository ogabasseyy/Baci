-- Waybill stamping immutability checks for gigl_provider_cancellation_wallet_refund.sql (\ir part).

-- T8: complete_merchant_shipping_charge stamps the booked waybill, and later
-- status writes or tracking edits never re-stamp it.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $t8_complete$
BEGIN
  IF public.complete_merchant_shipping_charge(
       'c4ce1500-0000-4000-8000-000000000008', 'attempt-8',
       'c4ce1400-0000-4000-8000-000000000008'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T8: the owner must complete the booking';
  END IF;
END;
$t8_complete$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t8$
DECLARE
  v_charge constant uuid := pg_temp.fixture_id(5, 8);
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges WHERE id = v_charge)
     IS DISTINCT FROM 'WB-CANCEL-8' THEN
    RAISE EXCEPTION 'T8: booking must stamp the shipment waybill';
  END IF;
  UPDATE public.shipments SET tracking_number = 'WB-SWAPPED-8'
  WHERE id = pg_temp.fixture_id(4, 8);
  UPDATE public.merchant_shipping_charges SET status = 'booked' WHERE id = v_charge;
  UPDATE public.merchant_shipping_charges SET status = 'refunded'
  WHERE id = pg_temp.fixture_id(5, 1);
  IF (SELECT provider_reference FROM public.merchant_shipping_charges WHERE id = v_charge)
       IS DISTINCT FROM 'WB-CANCEL-8'
     OR (SELECT provider_reference FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 1)) IS DISTINCT FROM 'WB-CANCEL-1' THEN
    RAISE EXCEPTION 'T8: the stamped waybill must never move';
  END IF;
END;
$t8$;
