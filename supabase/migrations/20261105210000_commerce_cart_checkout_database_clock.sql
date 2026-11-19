-- Return the database clock paired with checkout expiry timestamps. Keep the
-- value out of the persisted idempotency receipt and refresh it on replay.
DO $repair$
DECLARE definition text; old text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_prepare_checkout(uuid,integer,text)'::regprocedure);
  IF position('databaseNow' IN definition) > 0 THEN RETURN; END IF;

  old := $old$    RETURN pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true', true),
        '{grantExpiresAt}',pg_catalog.to_jsonb(v_grant_expires_at),true),
      '{sessionExpiresAt}', pg_catalog.to_jsonb(least(v_session.expires_at,v_session.created_at+interval '7 days',v_absolute_deadline)), true);$old$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'checkout replay database clock source mismatch';
  END IF;
  definition := replace(definition, old, $new$    RETURN pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true', true),
          '{grantExpiresAt}',pg_catalog.to_jsonb(v_grant_expires_at),true),
        '{sessionExpiresAt}', pg_catalog.to_jsonb(least(v_session.expires_at,v_session.created_at+interval '7 days',v_absolute_deadline)), true),
      '{databaseNow}', pg_catalog.to_jsonb(now()), true);$new$);

  old := $old$  RETURN v_result;$old$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'checkout fresh database clock source mismatch';
  END IF;
  definition := replace(definition, old, $new$  RETURN pg_catalog.jsonb_set(v_result, '{databaseNow}', pg_catalog.to_jsonb(now()), true);$new$);
  EXECUTE definition;
END $repair$;
