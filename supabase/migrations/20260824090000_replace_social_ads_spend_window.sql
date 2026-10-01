-- Replace each provider's requested reporting window atomically.
-- A successful provider sync can legitimately return no activity; deleting the
-- window before upserting the fresh rows prevents yesterday's observations
-- from surviving as if they were current.

BEGIN;

CREATE OR REPLACE FUNCTION public.replace_merchant_ads_spend_daily_window(
  p_merchant_id pg_catalog.uuid,
  p_provider pg_catalog.text,
  p_start_date pg_catalog.date,
  p_end_date pg_catalog.date,
  p_rows pg_catalog.jsonb
)
RETURNS pg_catalog.int4
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row pg_catalog.jsonb;
BEGIN
  IF NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'integrations', 'manage'
  ) THEN
    RETURN 0;
  END IF;
  IF p_provider IS NULL
    OR p_provider NOT IN ('meta_ads', 'tiktok_ads', 'snapchat_ads')
    OR p_start_date IS NULL
    OR p_end_date IS NULL
    OR p_start_date > p_end_date
    OR pg_catalog.jsonb_typeof(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) <> 'array'
    OR pg_catalog.jsonb_array_length(COALESCE(p_rows, '[]'::pg_catalog.jsonb)) > 400 THEN
    RAISE EXCEPTION 'invalid ads spend replacement window';
  END IF;

  -- Validate the date envelope before deleting anything. The existing upsert
  -- RPC validates the complete row shape and selected account identity.
  FOR v_row IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::pg_catalog.jsonb))
  LOOP
    IF pg_catalog.jsonb_typeof(v_row) <> 'object'
      OR COALESCE((v_row ->> 'spend_date') !~ '^\d{4}-\d{2}-\d{2}$', true)
      OR (v_row ->> 'spend_date') < p_start_date::pg_catalog.text
      OR (v_row ->> 'spend_date') > p_end_date::pg_catalog.text THEN
      RAISE EXCEPTION 'ads spend row is outside replacement window';
    END IF;
  END LOOP;

  DELETE FROM public.merchant_ad_spend_daily
  WHERE merchant_id = p_merchant_id
    AND provider = p_provider
    AND spend_date BETWEEN p_start_date AND p_end_date;

  RETURN public.upsert_merchant_ads_spend_daily(
    p_merchant_id,
    p_provider,
    COALESCE(p_rows, '[]'::pg_catalog.jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, date, date, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_merchant_ads_spend_daily_window(
  uuid, text, date, date, jsonb
) TO authenticated, service_role;

COMMIT;
