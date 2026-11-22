-- Extend PostgREST request-scope guard (`enforce_gigl_tracking_worker_request_scope`)
-- to restrict `quiz_edge_batch_worker` strictly to its four POST RPC endpoints.
DO $guard$
DECLARE
  v_definition text;
  v_hook_proc regprocedure := pg_catalog.to_regprocedure(
    'public.enforce_gigl_tracking_worker_request_scope()'
  );
BEGIN
  IF v_hook_proc IS NULL THEN
    RETURN;
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_hook_proc);
  IF pg_catalog.strpos(v_definition, '''/rpc/score_quiz_edge_staged_batches_incremental_v2''') > 0 THEN
    RETURN;
  END IF;
  IF pg_catalog.strpos(v_definition, 'request_role = ''mcp_guest_cart_worker''') > 0 THEN
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      '(''/rpc/delete_mcp_guest_cart''\s*\)\s*THEN\s*RAISE EXCEPTION ''Guest cart worker request is outside its capability scope''\s*USING ERRCODE = ''42501'';\s*END IF;)',
      '\1
  ELSIF request_role = ''quiz_edge_batch_worker'' THEN
    IF request_method IS DISTINCT FROM ''POST''
      OR request_path IS NULL
      OR request_path NOT IN (
        ''/rpc/ingest_quiz_edge_attempt_batch_v2'',
        ''/rpc/record_quiz_edge_room_seal_v2'',
        ''/rpc/get_quiz_edge_reconciliation_status_v2'',
        ''/rpc/score_quiz_edge_staged_batches_incremental_v2''
      ) THEN
      RAISE EXCEPTION ''Quiz edge batch worker request is outside its capability scope''
        USING ERRCODE = ''42501'';
    END IF;'
    );
    EXECUTE v_definition;
  END IF;
END $guard$;
