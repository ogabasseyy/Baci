DO $$
DECLARE v_missing text; v_transfer text; v_release text; v_result text; v_expiry text;
BEGIN
  SELECT string_agg(name, ', ') INTO v_missing
  FROM (VALUES
    ('attempts_terminalized_at'), ('finalization_state'), ('claim_window_seconds')
  ) expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'quiz_events' AND c.column_name = expected.name
  );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'missing quiz event columns: %', v_missing; END IF;

  IF to_regclass('public.quiz_prize_reservations') IS NULL THEN
    RAISE EXCEPTION 'quiz_prize_reservations missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
    AND indexname = 'idx_quiz_awards_one_ranked_product_v2_per_event'
    AND indexdef LIKE '%award_source = ''ranked_product_v2''%') THEN
    RAISE EXCEPTION 'ranked product award uniqueness invariant missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.finalize_due_live_quiz_events_v2(boolean,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.finalize_due_test_quiz_events_v2()', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalizers exposed to player roles';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.finalize_due_live_quiz_events_v2(boolean,boolean)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.finalize_due_test_quiz_events_v2()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service finalizer grants missing';
  END IF;
  IF has_function_privilege('anon', 'public.get_quiz_attempt_result_v2(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_quiz_attempt_result_v2(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'owner result RPC grants invalid';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.quiz_prize_reservations', 'SELECT') THEN
    RAISE EXCEPTION 'service_role SELECT grant on quiz_prize_reservations missing';
  END IF;
  IF has_table_privilege('service_role', 'public.quiz_prize_reservations', 'INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'service_role write privileges on quiz_prize_reservations should remain revoked';
  END IF;
  IF has_table_privilege('anon', 'public.quiz_prize_reservations', 'SELECT')
    OR has_table_privilege('authenticated', 'public.quiz_prize_reservations', 'SELECT') THEN
    RAISE EXCEPTION 'player roles must not have SELECT on quiz_prize_reservations';
  END IF;

  IF pg_get_functiondef('public.finalize_due_quiz_events()'::regprocedure)
    NOT LIKE '%e.contract_version = 1%' THEN
    RAISE EXCEPTION 'legacy finalizer is not contract-v1 scoped';
  END IF;
  v_transfer := pg_get_functiondef('private.transfer_quiz_prize_to_winner_v2(uuid,uuid,uuid)'::regprocedure);
  v_release := pg_get_functiondef('private.release_quiz_prize_reservation_v2(uuid,text)'::regprocedure);
  v_result := pg_get_functiondef('public.get_quiz_attempt_result_v2(uuid)'::regprocedure);
  v_expiry := pg_get_functiondef('public.expire_unclaimed_ranked_quiz_awards_v2()'::regprocedure);
  IF v_transfer LIKE '%SET status = ''available''%' THEN
    RAISE EXCEPTION 'serialized transfer reopens the held unit to legacy selection';
  END IF;
  IF v_transfer NOT LIKE '%WHERE id = v_res.inventory_unit_id%'
    OR v_transfer NOT LIKE '%order_item_id = v_order_item_id%'
    OR v_transfer NOT LIKE '%v_res.inventory_kind <> ''serialized''%'
    OR v_transfer LIKE '%claim_variant_inventory_units_for_order_item_internal%' THEN
    RAISE EXCEPTION 'serialized transfer is not exact or still enters the legacy selector';
  END IF;
  IF strpos(v_release, 'FROM public.quiz_events') >= strpos(v_release, 'FROM public.quiz_prize_reservations') THEN
    RAISE EXCEPTION 'reservation release does not lock event first';
  END IF;
  IF v_release NOT LIKE '%state = ''released''%RETURN false%'
    OR strpos(v_release, 'FROM public.quiz_prize_reservations') >= strpos(v_release, 'FROM public.quiz_awards') THEN
    RAISE EXCEPTION 'reservation release is not one-way or violates lock order';
  END IF;
  IF strpos(v_expiry, 'FOR UPDATE OF e SKIP LOCKED') = 0
    OR strpos(v_expiry, 'FOR UPDATE OF e SKIP LOCKED') >= strpos(v_expiry, 'UPDATE public.quiz_awards') THEN
    RAISE EXCEPTION 'award expiry does not acquire the event lock first';
  END IF;
  IF v_result NOT LIKE '%''availability'', ''final''%'
    OR v_result NOT LIKE '%''totalQuestions'', v_event.question_count%'
    OR v_result NOT LIKE '%IF v_rank IS NULL THEN%'
    OR v_result LIKE '%''status'', v_award.status%' THEN
    RAISE EXCEPTION 'owner result RPC does not expose v2 availability contract';
  END IF;
END $$;
