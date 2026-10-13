BEGIN;

DO $$
DECLARE
  v_claim_definition text;
  v_resume_definition text;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.get_quiz_attempt_prize_claim_v2(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'quiz v2 prize-claim projection is missing';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.resume_quiz_attempt_v2(uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'quiz v2 recovery function is missing';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_quiz_attempt_prize_claim_v2(uuid,uuid)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.resume_quiz_attempt_v2(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous role must not execute owner-scoped quiz recovery functions';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_quiz_attempt_prize_claim_v2(uuid,uuid)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.resume_quiz_attempt_v2(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated role cannot execute quiz recovery functions';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.get_quiz_attempt_prize_claim_v2(uuid,uuid)'::regprocedure
  ) INTO v_claim_definition;
  SELECT pg_catalog.pg_get_functiondef(
    'public.resume_quiz_attempt_v2(uuid,text)'::regprocedure
  ) INTO v_resume_definition;

  IF pg_catalog.strpos(v_claim_definition, 'SECURITY DEFINER') = 0
    OR pg_catalog.strpos(v_claim_definition, 'auth.uid() = p_user_id') = 0
    OR pg_catalog.strpos(v_claim_definition, '''claimExpiresAt''') = 0
    OR pg_catalog.strpos(v_claim_definition, '''productId''') = 0
    OR pg_catalog.strpos(v_claim_definition, '''variantId''') = 0
  THEN
    RAISE EXCEPTION 'prize-claim projection is not owner-scoped and bounded';
  END IF;
  IF pg_catalog.strpos(v_resume_definition, '''attemptId''') = 0
    OR pg_catalog.strpos(v_resume_definition, 'status IN (''submitted'', ''event_cancelled'')') = 0
  THEN
    RAISE EXCEPTION 'terminal recovery does not preserve the attempt id';
  END IF;
  IF pg_catalog.strpos(
    v_resume_definition,
    'OR v_event.results_published_at IS NOT NULL'
  ) > 0 THEN
    RAISE EXCEPTION 'submitted attempts remain gated until the event closes';
  END IF;
END;
$$;

ROLLBACK;
