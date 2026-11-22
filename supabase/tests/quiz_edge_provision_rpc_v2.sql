-- Verifies `public.prepare_quiz_edge_rooms_v2(uuid, uuid, integer)` exists,
-- is SECURITY DEFINER, enforces `check_staff_permission`, and grants EXECUTE
-- only to `authenticated` and `service_role` (never `anon` or `PUBLIC`).

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.prepare_quiz_edge_rooms_v2(uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF pg_catalog.strpos(v_def, 'SECURITY DEFINER') = 0
    OR pg_catalog.strpos(v_def, 'check_staff_permission') = 0
    OR pg_catalog.strpos(v_def, 'edge_rooms') = 0
    OR pg_catalog.strpos(v_def, 'expected_room_count') = 0
  THEN
    RAISE EXCEPTION 'prepare_quiz_edge_rooms_v2 missing expected security or edge room wiring';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.prepare_quiz_edge_rooms_v2(uuid,uuid,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', 'public.prepare_quiz_edge_rooms_v2(uuid,uuid,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', 'public.prepare_quiz_edge_rooms_v2(uuid,uuid,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'prepare_quiz_edge_rooms_v2 EXECUTE privileges are misconfigured';
  END IF;
END;
$$;
