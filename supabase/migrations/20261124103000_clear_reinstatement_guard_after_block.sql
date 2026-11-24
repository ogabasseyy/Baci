-- A blocked paid flip must not leave its transaction-local trigger bypass
-- armed for later writes issued in the same RPC transaction.
DO $$
DECLARE
  definition text;
  needle text;
BEGIN
  definition := pg_catalog.pg_get_functiondef(
    'public.reinstate_timeout_order_payment(uuid,uuid)'::regprocedure
  );
  needle := $needle$  EXCEPTION WHEN SQLSTATE 'BX001' THEN
    RETURN 'blocked';$needle$;
  IF pg_catalog.strpos(definition, needle) = 0 THEN
    RAISE EXCEPTION 'Unexpected late-payment reinstatement exception handler';
  END IF;
  definition := pg_catalog.replace(
    definition,
    needle,
    $replacement$  EXCEPTION WHEN SQLSTATE 'BX001' THEN
    PERFORM pg_catalog.set_config('baci.reinstating_order_id', '', true);
    RETURN 'blocked';$replacement$
  );
  EXECUTE definition;
END;
$$;
