DO $guard$
DECLARE expected jsonb; actual jsonb;
BEGIN
  SELECT evidence INTO STRICT expected FROM pg_temp.cb_expected;
  SELECT evidence INTO STRICT actual FROM pg_temp.cb_snapshot;
  IF clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR (expected->>'capturedAt')::timestamptz>clock_timestamp()
    OR clock_timestamp()-(expected->>'capturedAt')::timestamptz>interval '300 seconds'
    OR (actual-'capturedAt') IS DISTINCT FROM (expected-'capturedAt') THEN
    RAISE EXCEPTION 'claim boundary exact fresh snapshot differs' USING ERRCODE='55000';
  END IF;
  IF actual->'unsupportedRelations'<>'[]'::jsonb
    OR to_regclass('prefunded_card.checkout_intents') IS NULL
    OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
    RAISE EXCEPTION 'claim boundary unsupported relation or event trigger' USING ERRCODE='55000';
  END IF;
END $guard$;
