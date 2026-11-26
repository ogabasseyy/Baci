\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/paid-order-amendments/verified-funding-setup.inc.sql
DO $$
DECLARE
  f jsonb;
  o uuid;
  m uuid;
  method text;
  selection jsonb;
  quote jsonb;
  payload jsonb;
  result jsonb;
  top_up jsonb;
  amendment uuid;
  existing_receipt uuid;
  prior_order uuid;
BEGIN
  FOREACH method IN ARRAY ARRAY['cash','pos'] LOOP
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    f := pg_temp.verified_funding_fixture('credit_direct',false,2000000);
    o := (f->>'order')::uuid;
    m := (f->>'merchant')::uuid;
    DELETE FROM private.paid_order_bank_evidence WHERE id = (f->>'bankEvidenceId')::uuid;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
    selection := jsonb_build_object('lineId',f->>'line','replacement',jsonb_build_object('id',f->>'variant','kind','variant'));
    quote := public.preview_paid_order_amendment(o,selection);
    IF quote ? 'canRecordStaffTopUp' THEN RAISE EXCEPTION 'Staff tender unexpectedly enabled by default'; END IF;
    UPDATE private.paid_order_amendment_config SET staff_tender_enabled = true,version = version + 1
    WHERE merchant_id = m;
    INSERT INTO private.paid_order_bank_evidence(
      merchant_id,account_id,bank_transaction_id,direction,amount_minor,currency,
      occurred_at,statement_entry,bound_order_id,collection_method
    )
    SELECT m,bank_account_id,'tender:pos:PENDING-' || o,
      'incoming',2000000,'NGN',now(),'Hidden POS receipt fixture',o,'pos'
    FROM private.paid_order_amendment_config WHERE merchant_id = m
    RETURNING id INTO existing_receipt;
    quote := public.preview_paid_order_amendment(o,selection);
    IF quote ? 'canRecordStaffTopUp' OR quote->'bankEvidence' IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'A disabled receipt may not be replaced by a new staff payment';
    END IF;
    DELETE FROM private.paid_order_bank_evidence WHERE id = existing_receipt;
    quote := public.preview_paid_order_amendment(o,selection);
    IF quote->'canRecordStaffTopUp' IS DISTINCT FROM 'true'::jsonb
      OR quote->>'adjustmentMinor' IS DISTINCT FROM '2000000' THEN
      RAISE EXCEPTION 'Staff payment missing from valid preview';
    END IF;
    payload := jsonb_build_object('previewId',quote->>'previewId','customerAgreed',true,
      'reason','Synthetic staff top-up','idempotencyKey','staff-top-up-fixture',
      'staffTopUp',jsonb_build_object('method',method));
    IF method = 'pos' THEN
      BEGIN
        PERFORM public.confirm_paid_order_amendment(o,payload);
        RAISE EXCEPTION 'POS confirmed without its receipt reference';
      EXCEPTION WHEN invalid_parameter_value THEN
        IF SQLERRM <> 'invalid_amendment_confirmation' THEN RAISE; END IF;
      END;
      FOREACH payload IN ARRAY ARRAY[
        jsonb_set(payload,'{staffTopUp,receiptReference}',to_jsonb('SHORT7'::text)),
        -- Seven characters must be rejected by the database guard.
        jsonb_set(payload,'{staffTopUp,receiptReference}',to_jsonb('ABCDEFG'::text)),
        jsonb_set(payload,'{staffTopUp,receiptReference}',to_jsonb('-POS-12345'::text))
      ] LOOP
        BEGIN
          PERFORM public.confirm_paid_order_amendment(o,payload);
          RAISE EXCEPTION 'POS confirmed with an invalid receipt reference';
        EXCEPTION WHEN invalid_parameter_value THEN
          IF SQLERRM <> 'invalid_amendment_confirmation' THEN RAISE; END IF;
        END;
      END LOOP;
      payload := jsonb_set(payload,'{staffTopUp,receiptReference}',to_jsonb('POS12345'::text));
      BEGIN
        PERFORM public.confirm_paid_order_amendment(o,payload);
        RAISE EXCEPTION 'accepted eight-character POS reference';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'accepted eight-character POS reference' THEN RAISE; END IF;
      END;
      payload := jsonb_set(payload,'{staffTopUp,receiptReference}',to_jsonb('  pos-fixture-' || o || '  '));
      prior_order := gen_random_uuid();
      INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_status,shipping_status,total,subtotal)
      VALUES (prior_order,m,'PRIOR-POS-' || prior_order,'mobile_app','NGN','unpaid','pending',10000,10000);
      INSERT INTO private.paid_order_bank_evidence(
        merchant_id,account_id,bank_transaction_id,direction,amount_minor,currency,
        occurred_at,statement_entry,bound_order_id,collection_method
      )
      SELECT m,bank_account_id,'tender:pos:' || upper('pos-fixture-' || o),
        'incoming',1000000,'NGN',now(),'Existing POS receipt fixture',prior_order,'pos'
      FROM private.paid_order_amendment_config WHERE merchant_id = m
      RETURNING id INTO existing_receipt;
      BEGIN
        PERFORM public.confirm_paid_order_amendment(o,payload);
        RAISE EXCEPTION 'A previously recorded POS receipt was reused';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'staff_pos_receipt_used' THEN RAISE; END IF;
      END;
      DELETE FROM private.paid_order_bank_evidence WHERE id = existing_receipt;
    END IF;
    PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    BEGIN
      PERFORM public.confirm_paid_order_amendment(o,payload);
      RAISE EXCEPTION 'Unrelated staff recorded a top-up';
    EXCEPTION WHEN no_data_found THEN
      IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
    SET LOCAL ROLE authenticated;
    result := public.confirm_paid_order_amendment(o,payload);
    RESET ROLE;
    amendment := (result->>'amendmentId')::uuid;
    UPDATE private.paid_order_amendment_config SET enabled = false,staff_tender_enabled = false,
      version = version + 1 WHERE merchant_id = m;
    IF result->>'state' IS DISTINCT FROM 'settled'
      OR public.confirm_paid_order_amendment(o,payload) IS DISTINCT FROM result
      OR (SELECT count(*) FROM public.transactions WHERE order_id = o
        AND transaction_type = 'payment' AND metadata->>'paid_order_amendment_id' = amendment::text
        AND metadata->>'payment_method' = method AND amount = 20000) <> 1
      OR (SELECT amount_paid FROM public.orders WHERE id = o) <> 149867.50
      OR (SELECT count(*) FROM private.paid_order_amendment_events WHERE amendment_id = amendment
        AND event_type = 'top_up_recorded' AND actor_id = (f->>'actor')::uuid) <> 1
      OR (SELECT count(*) FROM private.paid_order_amendment_documents WHERE amendment_id = amendment) <> 1
      OR (SELECT variant_id FROM public.order_items WHERE id = (f->>'line')::uuid) IS DISTINCT FROM (f->>'variant')::uuid
      THEN RAISE EXCEPTION 'Invalid staff settlement or replay for %',method;
    END IF;
    SELECT details->'staffTopUp' INTO STRICT top_up FROM private.paid_order_amendment_events
    WHERE amendment_id = amendment AND event_type = 'confirmed';
    IF top_up->>'method' IS DISTINCT FROM method OR (method = 'pos' AND
      top_up->>'receiptReference' IS DISTINCT FROM upper('pos-fixture-' || o))
      THEN RAISE EXCEPTION 'Wrong staff receipt audit for %',method;
    END IF;
    RAISE NOTICE '% posted one top-up and one revised invoice; replay returned the original result',method;
  END LOOP;
END;
$$;
ROLLBACK;
