-- Fail-closed input bounds for the SECURITY DEFINER revenue-chart RPC.

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

CREATE OR REPLACE FUNCTION pg_temp.assert_chart_rejected(
  p_label text,
  p_buckets jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.get_mobile_admin_revenue_chart(
      '9b0d0e12-0000-4000-8000-000000000101', p_buckets, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION '% unexpectedly accepted', p_label;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_chart_rejected(text, jsonb) TO PUBLIC; -- called after SET ROLE

SELECT pg_temp.assert_chart_rejected(
  'missing start bound',
  '[{"ordinal":0,"label":"Missing","end_at":"2026-07-02T00:00:00Z"}]'
);
SELECT pg_temp.assert_chart_rejected(
  'missing end bound',
  '[{"ordinal":0,"label":"Missing","start_at":"2026-07-01T00:00:00Z"}]'
);
SELECT pg_temp.assert_chart_rejected(
  'zero-width bucket',
  '[{"ordinal":0,"label":"Zero","start_at":"2026-07-01T00:00:00Z","end_at":"2026-07-01T00:00:00Z"}]'
);
SELECT pg_temp.assert_chart_rejected(
  'reversed bucket',
  '[{"ordinal":0,"label":"Reverse","start_at":"2026-07-02T00:00:00Z","end_at":"2026-07-01T00:00:00Z"}]'
);
SELECT pg_temp.assert_chart_rejected(
  '65 buckets',
  (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'ordinal', position,
      'label', 'Bucket ' || position,
      'start_at', '2026-07-01T00:00:00Z',
      'end_at', '2026-07-02T00:00:00Z'
    ))
    FROM pg_catalog.generate_series(1, 65) AS position
  )
);

DO $valid_limit$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.get_mobile_admin_revenue_chart(
    '9b0d0e12-0000-4000-8000-000000000101',
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'ordinal', position,
      'label', 'Bucket ' || position,
      'start_at', '2026-07-01T00:00:00Z',
      'end_at', '2026-07-02T00:00:00Z'
    )),
    NULL
  )
  INTO v_result
  FROM pg_catalog.generate_series(1, 64) AS position;

  IF pg_catalog.jsonb_array_length(v_result) IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION '64 valid buckets did not remain supported: %', v_result;
  END IF;
END;
$valid_limit$;

ROLLBACK;
