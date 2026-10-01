-- Include merchant ownership in the orderless-monitor fast path so a
-- reassigned order-backed shipment still deactivates its GIGL monitor.

DO $migration$
DECLARE
  v_original_definition text;
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'private.activate_gigl_tracking_monitor()'::regprocedure
  ) INTO v_original_definition;
  v_definition := replace(
    v_original_definition,
    E'     AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id\n'
      || E'     AND (NEW.order_id IS NOT NULL OR v_is_repair_linked) THEN',
    E'     AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id\n'
      || E'     AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id\n'
      || E'     AND (v_order_is_owned OR v_is_repair_linked) THEN'
  );
  IF v_definition = v_original_definition
    OR v_definition NOT LIKE
      '%AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id%'
    OR v_definition NOT LIKE '%AND (v_order_is_owned OR v_is_repair_linked) THEN%'
  THEN
    RAISE EXCEPTION
      'GIGL monitor identity must include merchant ownership on the fast path';
  END IF;
  EXECUTE v_definition;
END;
$migration$;
