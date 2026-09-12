-- Drop authenticated PostgREST access to raw provider payloads on shipments.
-- Bundled customer/merchant-safe fields remain selectable.

REVOKE SELECT ON TABLE public.shipments FROM authenticated;
GRANT SELECT (
  id, order_id, merchant_id, provider, provider_shipment_id, tracking_number,
  carrier_name, service_tier, price, currency, status, estimated_delivery_days,
  estimated_delivery_at, delivered_at, cancelled_at, label_url,
  pickup_scheduled_at, current_location, tracking_events, last_tracked_at,
  refund_amount, is_station_pickup, station_name, station_address,
  sender_address, receiver_address, items,
  shipping_quote_id, tracking_snapshot_version, tracking_timeline_generation,
  created_at, updated_at
) ON TABLE public.shipments TO authenticated;

COMMENT ON COLUMN public.shipments.provider_response IS
  'Raw provider booking payload. Not exposed to authenticated PostgREST clients.';
