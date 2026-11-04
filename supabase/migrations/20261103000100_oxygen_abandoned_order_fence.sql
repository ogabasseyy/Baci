-- A provider liability can outlive the ordinary unpaid-order timeout.
-- Preserve all Oxygen workflow orders until a reconciled lifecycle explicitly
-- allows their disposal; payment_status alone does not represent the liability.
DO $$
DECLARE definition text; needle text;
BEGIN
 definition := pg_get_functiondef('public.mark_abandoned_orders(integer)'::regprocedure);
 needle := $needle$      AND NOT EXISTS (
        SELECT 1
        FROM public.reconciliation_review rr$needle$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected abandoned-order cleanup definition'; END IF;
 definition := replace(definition,needle,$replacement$      AND NOT EXISTS (
        SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id=o.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reconciliation_review rr$replacement$);
 EXECUTE definition;
END $$;
