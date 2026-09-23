-- Hide internal GIGL order economics from authenticated/anonymous PostgREST
-- reads. Service-role settlement and booking paths still use these columns.

REVOKE SELECT (
  shipping_provider_cost,
  shipping_platform_margin,
  shipping_platform_retained_amount,
  shipping_pricing_version
) ON TABLE public.orders FROM authenticated, anon;

COMMENT ON COLUMN public.orders.shipping_provider_cost IS
  'Internal GIGL provider tariff. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.orders.shipping_platform_margin IS
  'Internal platform margin. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.orders.shipping_platform_retained_amount IS
  'Internal retained shipping amount. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.orders.shipping_pricing_version IS
  'Internal shipping pricing version. Not exposed to authenticated PostgREST clients.';
