-- Keep provider tariff and platform margin fields out of authenticated
-- PostgREST reads.  The original shipping_quotes grant is table-wide, so
-- response shaping in the quote API is not an access boundary: a merchant
-- staff client can select the internal columns directly.
--
-- The table remains writable by the existing scoped server/admin paths.  Only
-- the authenticated SELECT surface is reduced to checkout/booking fields;
-- service_role retains the full table grant for trusted server-side workers.
BEGIN;

REVOKE SELECT ON TABLE public.shipping_quotes FROM authenticated;

GRANT SELECT (
  id,
  session_id,
  merchant_id,
  provider,
  service_tier,
  carrier_name,
  price,
  currency,
  estimated_days,
  min_days,
  max_days,
  pickup_included,
  insurance_included,
  provider_rate_id,
  is_station_pickup,
  station_name,
  station_address,
  quote_request,
  provider_metadata,
  used,
  expires_at,
  created_at
) ON TABLE public.shipping_quotes TO authenticated;

COMMENT ON COLUMN public.shipping_quotes.provider_cost IS
  'Internal GIGL provider tariff. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.shipping_quotes.platform_margin IS
  'Internal platform margin. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.shipping_quotes.platform_margin_bps IS
  'Internal platform margin basis points. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.shipping_quotes.pricing_version IS
  'Internal pricing contract version. Not exposed to authenticated PostgREST clients.';

COMMIT;
