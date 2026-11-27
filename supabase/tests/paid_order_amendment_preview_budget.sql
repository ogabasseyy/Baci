\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql
BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(0,NULL,false);
BEGIN
  INSERT INTO public.rate_limit_log(identifier,endpoint,window_start,request_count)
    VALUES (f->>'actor','order_amendment_preview_rpc',date_trunc('second',clock_timestamp()),30)
    ON CONFLICT (identifier,endpoint,window_start) DO UPDATE SET request_count=EXCLUDED.request_count;
  BEGIN
    PERFORM public.preview_paid_order_amendment((f->>'order')::uuid,jsonb_build_object('lineId',f->>'line',
      'replacement',jsonb_build_object('kind','product','id',f->>'replacement')));
    RAISE EXCEPTION 'preview row exceeded the per-minute database limit';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_rate_limited' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM private.paid_order_amendment_previews WHERE order_id=(f->>'order')::uuid) <> 1
  THEN RAISE EXCEPTION 'an extra preview record was stored'; END IF;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  f jsonb := pg_temp.amendment_settlement_seed(0,NULL,false);
  foreign_order jsonb;
  selection jsonb := jsonb_build_object('lineId',f->>'line','ignored','unused',
    'replacement',jsonb_build_object('kind','product','id',f->>'replacement','ignored','unused'));
  confirmation jsonb;
  preview jsonb;
  confirmed jsonb;
BEGIN
  preview := public.preview_paid_order_amendment((f->>'order')::uuid,selection);
  IF (SELECT p.selection FROM private.paid_order_amendment_previews p WHERE id=(preview->>'previewId')::uuid)
    IS DISTINCT FROM jsonb_build_object('lineId',f->>'line',
      'replacement',jsonb_build_object('kind','product','id',f->>'replacement'))
  THEN RAISE EXCEPTION 'preview retained unsupported fields'; END IF;
  confirmation := jsonb_build_object('previewId',preview->>'previewId','customerAgreed',true,
    'reason','Synthetic replacement','idempotencyKey','fixture-isolation');
  confirmed := public.confirm_paid_order_amendment((f->>'order')::uuid,confirmation);
  foreign_order := pg_temp.amendment_settlement_seed(0,NULL,false);
  IF auth.uid() IS DISTINCT FROM (foreign_order->>'actor')::uuid
  THEN RAISE EXCEPTION 'fixture did not switch to a different merchant'; END IF;

  BEGIN
    PERFORM public.preview_paid_order_amendment((f->>'order')::uuid,selection);
    RAISE EXCEPTION 'foreign preview succeeded';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.confirm_paid_order_amendment((f->>'order')::uuid,confirmation);
    RAISE EXCEPTION 'foreign confirmation replay succeeded';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.read_paid_order_amendment_workspace((f->>'order')::uuid);
    RAISE EXCEPTION 'foreign workspace read succeeded';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_paid_order_amendment_replacements((f->>'order')::uuid,(f->>'line')::uuid,'replacement');
    RAISE EXCEPTION 'foreign catalog search succeeded';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'order_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.run_paid_order_amendment_action((f->>'order')::uuid,(confirmed->>'amendmentId')::uuid,
      '{"action":"reverse","reason":"Synthetic request","idempotencyKey":"fixture-isolation"}');
    RAISE EXCEPTION 'foreign amendment action succeeded';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'amendment_not_found' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;
