-- Table-level SELECT and column-level SELECT are additive in PostgreSQL.
-- Column-only REVOKE therefore cannot hide economics while GRANT ALL ON
-- public.orders remains. Mirror the shipments pattern: revoke table SELECT,
-- then grant an explicit safe column projection for PostgREST clients.

DO $$
DECLARE
  safe_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO safe_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name NOT IN (
      'shipping_provider_cost',
      'shipping_platform_margin',
      'shipping_platform_retained_amount',
      'shipping_pricing_version'
    );

  IF safe_columns IS NULL OR length(trim(safe_columns)) = 0 THEN
    RAISE EXCEPTION 'orders safe column projection is empty';
  END IF;

  EXECUTE 'REVOKE SELECT ON TABLE public.orders FROM authenticated, anon';
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.orders TO authenticated, anon',
    safe_columns
  );
END
$$;
