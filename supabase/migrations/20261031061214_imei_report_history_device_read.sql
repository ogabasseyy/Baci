-- Device category is customer-visible report metadata. Existing ownership RLS
-- remains authoritative; provider identifiers, costs and write grants stay private.
GRANT SELECT (device_category) ON public.imei_lookups TO authenticated;
