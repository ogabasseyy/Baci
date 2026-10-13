-- Forward-repair the retry wrappers without editing their append-only sources.
-- The wrappers must enforce the same order-edit permission and tenant scope as
-- the delegated reconciliation implementation before returning a retry.
DO $migration$
DECLARE
  v_signature text;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.reconcile_paystack_unmatched_partial_payment(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text)',
    'public.reconcile_paystack_unmatched_partial_payment(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text,boolean)'
  ] LOOP
    SELECT pg_catalog.pg_get_functiondef(p.oid)
      INTO v_definition
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_signature::regprocedure;

    v_updated := replace(
      v_definition,
      'AND sm.status = ''active''',
      'AND sm.status = ''active''' || chr(10)
      || '       AND public.check_staff_permission(p_operator_user_id, p_merchant_id, ''orders'', ''edit'') IS TRUE'
    );
    v_updated := replace(
      v_updated,
      'WHERE t.order_id = p_order_id',
      'WHERE t.order_id = p_order_id' || chr(10)
      || '       AND t.merchant_id = p_merchant_id' || chr(10)
      || '       AND o.merchant_id = p_merchant_id'
    );

    IF v_definition NOT LIKE '%AND sm.status = ''active''%'
       OR v_definition NOT LIKE '%WHERE t.order_id = p_order_id%'
       OR v_updated NOT LIKE '%AND t.merchant_id = p_merchant_id%'
       OR v_updated NOT LIKE '%AND o.merchant_id = p_merchant_id%'
       OR v_updated = v_definition THEN
      RAISE EXCEPTION 'paystack_retry_scope_repair_not_applied: %', v_signature;
    END IF;
    EXECUTE v_updated;
  END LOOP;
END;
$migration$;
