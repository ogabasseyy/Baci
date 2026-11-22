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
