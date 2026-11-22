\set ON_ERROR_STOP on
DO $$
BEGIN
  IF to_regprocedure('public.read_paid_order_amendment_document(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'versioned amendment document read is missing';
  END IF;
END;
$$;

\ir fixtures/paid-order-amendments/settlement-setup.inc.sql
BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(5000000,NULL,false);
  o uuid := (f->>'order')::uuid;
  m uuid := (f->>'merchant')::uuid;
  a uuid;
  shopper uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  confirmed_event bigint;
  settled_event bigint;
  original jsonb;
  first_doc jsonb;
  later_doc jsonb;
  pinned uuid;
  bank uuid;
  delivery jsonb;
  token text := 'synthetic-order-proof-2026';
  slug text;
BEGIN
  UPDATE public.merchants SET vat_registration_status = 'registered', vat_rate = 0 WHERE id = m;
  INSERT INTO public.order_tax_subtotals(order_id,vat_category_code,vat_rate,taxable_amount,tax_amount,exemption_reason)
    VALUES (o,'Z',0,300000,0,'Synthetic zero-rate snapshot');
  a := (public.confirm_paid_order_amendment(o,jsonb_build_object(
    'previewId',f->>'preview','customerAgreed',true,'reason','Synthetic swap','idempotencyKey','fixture-confirm'
  ))->>'amendmentId')::uuid;
  f := f || jsonb_build_object('amendment',a);
  UPDATE public.merchants SET vat_registration_status = 'not_registered', vat_rate = 7.5 WHERE id = m;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (shopper,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fixture-buyer@example.invalid',now(),now());
  INSERT INTO public.customers(id,merchant_id,user_id,email) VALUES (customer,m,shopper,'fixture-buyer@example.invalid');
  UPDATE public.orders SET customer_id = customer,customer_email = 'fixture-buyer@example.invalid',tracking_token = token WHERE id = o;
  SELECT merchants.slug INTO slug FROM public.merchants WHERE id = m;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF (public.read_paid_order_amendment_workspace(o)->>'canStart')::boolean
    OR (public.read_paid_order_amendment_workspace(o)->>'canRefund')::boolean IS DISTINCT FROM true
    OR public.read_paid_order_amendment_workspace(o)->>'confirmationKey' IS DISTINCT FROM (
      SELECT idempotency_key FROM private.paid_order_amendments WHERE id = a
    ) THEN
    RAISE EXCEPTION 'staff workspace did not preserve amendment authorization';
  END IF;
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (staff,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fixture-staff@example.invalid',now(),now());
  INSERT INTO public.staff_members(merchant_id,user_id,email,status,permissions)
    VALUES (m,staff,'fixture-staff@example.invalid','active','{"orders":{"view":true,"edit":true}}');
  PERFORM set_config('request.jwt.claim.sub',staff::text,true);
  IF (public.read_paid_order_amendment_workspace(o)->>'canEdit')::boolean IS DISTINCT FROM true
    OR public.read_paid_order_amendment_workspace(o)->>'confirmationKey' IS NOT NULL THEN
    RAISE EXCEPTION 'another editor received the submitter confirmation key or was denied workspace access';
  END IF;
  IF public.read_paid_order_amendment_document(o,'original')#>>'{inputs,taxSubtotals,0,exemption_reason}'
    IS DISTINCT FROM 'Synthetic zero-rate snapshot' THEN
    RAISE EXCEPTION 'staff invoice projection lost the tax snapshot';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
  original := public.read_paid_order_amendment_document(o);
  first_doc := public.read_paid_order_amendment_document(o,'current');
  pinned := (first_doc#>>'{amendment,documentId}')::uuid;
  IF (original#>>'{inputs,order,total}')::numeric <> 300000
    OR original#>>'{inputs,items,0,name}' <> 'Original'
    OR (first_doc#>>'{inputs,order,total}')::numeric <> 350000
    OR first_doc#>>'{inputs,items,0,name}' <> 'Replacement'
    OR (first_doc#>>'{inputs,order,amount_paid}')::numeric <> 300000
    OR (first_doc#>>'{inputs,taxSubtotals,0,taxable_amount}')::numeric IS DISTINCT FROM 350000
    OR first_doc#>>'{inputs,sellerTax,registrationStatus}' IS DISTINCT FROM 'registered'
    OR pinned IS NULL OR first_doc#>'{inputs,items,0,fulfillment_data}' IS NOT NULL THEN
    RAISE EXCEPTION 'original/revised invoice snapshot mixed line, money, or private stock fields';
  END IF;
  SELECT id INTO STRICT confirmed_event FROM private.paid_order_amendment_events
    WHERE amendment_id = a AND event_type = 'confirmed';
  bank := pg_temp.amendment_bank(f,5000000);
  PERFORM pg_temp.amendment_action(f,jsonb_build_object('action','record_top_up','evidenceId',bank,'idempotencyKey','fixture-doc-settlement'));
  later_doc := public.read_paid_order_amendment_document(o,'current');
  IF (later_doc#>>'{inputs,order,amount_paid}')::numeric <> 350000
    OR (public.read_paid_order_amendment_document(o,pinned::text)#>>'{inputs,order,amount_paid}')::numeric <> 300000
    OR jsonb_array_length(later_doc#>'{inputs,payments}') <> 2
    OR jsonb_array_length(public.read_paid_order_amendment_document(o)#>'{inputs,payments}') <> 1
    OR public.read_paid_order_amendment_document(o)#>'{inputs}' IS DISTINCT FROM original#>'{inputs}' THEN
    RAISE EXCEPTION 'historical document changed during settlement';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',shopper::text,true);
  IF public.read_paid_order_amendment_document(o,'current')#>>'{amendment,state}' <> 'settled'
    OR public.read_paid_order_amendment_document(o,'current')#>>'{inputs,taxSubtotals,0,exemption_reason}'
      IS DISTINCT FROM 'Synthetic zero-rate snapshot' THEN
    RAISE EXCEPTION 'owned customer order cannot read the revised invoice';
  END IF;
  BEGIN
    PERFORM public.read_paid_order_amendment_workspace(o);
    RAISE EXCEPTION 'shopper accessed staff timeline';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.read_paid_order_amendment_document(o,pinned::text);
    RAISE EXCEPTION 'unrelated user accessed a pinned invoice';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claim.role','anon',true);
  IF public.read_paid_order_amendment_tracking(o,slug,token,NULL)->>'state' IS DISTINCT FROM 'settled'
    OR public.read_paid_order_amendment_tracking(o,'another-store',token,NULL) IS NOT NULL
    OR public.read_paid_order_amendment_tracking(o,slug,'wrong-proof',NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'guest amendment access did not bind the tracking proof';
  END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT id INTO STRICT settled_event FROM private.paid_order_amendment_events
    WHERE amendment_id = a AND event_type = 'top_up_recorded';
  IF public.claim_paid_order_amendment_update(confirmed_event) IS NOT NULL THEN
    RAISE EXCEPTION 'stale top-up request was delivered after settlement';
  END IF;
  delivery := public.claim_paid_order_amendment_update(settled_event);
  IF delivery#>>'{status,state}' IS DISTINCT FROM 'settled'
    OR public.claim_paid_order_amendment_update(settled_event) IS NOT NULL
    OR NOT public.complete_paid_order_amendment_update((delivery->>'claim')::uuid,true) THEN
    RAISE EXCEPTION 'settlement update did not dispatch once';
  END IF;

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',f->>'actor',true);
  PERFORM public.cancel_order_as_merchant(o,'Synthetic ordinary cancellation','automatic');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = o;
  IF public.read_paid_order_amendment_document(o,'live')#>>'{inputs,order,payment_status}' IS DISTINCT FROM 'refunded'
    OR public.read_paid_order_amendment_document(o,'current')#>>'{inputs,order,payment_status}' IS DISTINCT FROM 'paid'
    OR public.read_paid_order_amendment_tracking(o,slug,token,NULL)#>>'{order,payment_status}' IS DISTINCT FROM 'refunded'
    OR public.read_paid_order_amendment_tracking(o,slug,token,NULL)#>>'{order,shipping_status}' IS DISTINCT FROM 'cancelled'
    OR public.read_paid_order_amendment_tracking(o,slug,token,NULL)#>>'{order,cancelled_at}' IS NULL
    OR public.read_paid_order_amendment_document(o,'live')#>>'{inputs,order,shipping_status}' IS DISTINCT FROM 'cancelled'
    OR public.read_paid_order_amendment_document(o,'original')#>>'{inputs,order,shipping_status}' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ordinary cancellation altered archived documents or failed to reach live order details';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(-5000000);
  o uuid := (f->>'order')::uuid;
  a uuid := (f->>'amendment')::uuid;
  confirmed bigint;
  reversed bigint;
  delivery jsonb;
BEGIN
  UPDATE public.orders SET customer_email = 'reversal@example.invalid' WHERE id = o;
  SELECT id INTO STRICT confirmed FROM private.paid_order_amendment_events
    WHERE amendment_id = a AND event_type = 'confirmed';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  delivery := public.claim_paid_order_amendment_update(confirmed);
  IF delivery#>>'{status,state}' IS DISTINCT FROM 'awaiting_refund' THEN
    RAISE EXCEPTION 'latest revision could not send while the refund was open';
  END IF;
  PERFORM public.complete_paid_order_amendment_update((delivery->>'claim')::uuid,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.amendment_action(f,'{"action":"reverse","reason":"Fixture reversal","idempotencyKey":"fixture-reverse-update"}');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT id INTO STRICT reversed FROM private.paid_order_amendment_events
    WHERE amendment_id = a AND event_type = 'reversed';
  delivery := public.claim_paid_order_amendment_update(reversed);
  IF delivery#>>'{status,state}' IS DISTINCT FROM 'reversed'
    OR public.claim_paid_order_amendment_update(confirmed) IS NOT NULL THEN
    RAISE EXCEPTION 'reversal did not create a corrective update or allowed a repeated original update';
  END IF;
END;
$$;
ROLLBACK;

-- A committed top-up can publish a new version while an earlier download is
-- still rendering. The exact old version remains coherent in both snapshots.
\ir fixtures/paid-order-amendments/concurrency-lock.inc.sql
SELECT pg_temp.amendment_settlement_seed(5000000) AS fixture \gset
SELECT pg_temp.amendment_bank(:'fixture',5000000) AS evidence \gset
SELECT set_config('request.jwt.claim.role','authenticated',false) IS NOT NULL;
SELECT set_config('request.jwt.claim.sub',:'fixture'::jsonb->>'actor',false) IS NOT NULL;
SELECT public.read_paid_order_amendment_document((:'fixture'::jsonb->>'order')::uuid,'current')#>>'{amendment,documentId}' AS pinned \gset
SELECT dblink_connect('document_writer',format('dbname=%L user=%L host=%L port=%s password=%L',
  current_database(),current_user,inet_server_addr(),inet_server_port(),current_setting('baci.amendment_test_dblink_password')));
SELECT dblink_exec('document_writer','BEGIN');
SELECT dblink_exec('document_writer',format('SET request.jwt.claim.sub = %L',:'fixture'::jsonb->>'actor'));
SELECT dblink_exec('document_writer','SET request.jwt.claim.role = ''authenticated''');
SELECT * FROM dblink('document_writer',format('SELECT public.run_paid_order_amendment_action(%L,%L,%L)::text',
  :'fixture'::jsonb->>'order',:'fixture'::jsonb->>'amendment',
  jsonb_build_object('action','record_top_up','evidenceId',:'evidence','idempotencyKey','fixture-download-race'))) AS t(result text);
SELECT 1 / (((public.read_paid_order_amendment_document((:'fixture'::jsonb->>'order')::uuid,'current')
  #>>'{inputs,order,amount_paid}')::numeric = 300000)::int);
SELECT dblink_exec('document_writer','COMMIT');
SELECT 1 / (((public.read_paid_order_amendment_document((:'fixture'::jsonb->>'order')::uuid,'current')
  #>>'{inputs,order,amount_paid}')::numeric = 350000)::int);
SELECT 1 / (((public.read_paid_order_amendment_document((:'fixture'::jsonb->>'order')::uuid,:'pinned')
  #>>'{inputs,order,amount_paid}')::numeric = 300000)::int);
SELECT dblink_disconnect('document_writer');
