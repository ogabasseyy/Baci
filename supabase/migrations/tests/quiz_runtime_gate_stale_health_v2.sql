BEGIN;

DELETE FROM public.quiz_deadline_clock_health_v2 WHERE singleton;
UPDATE public.quiz_runtime_control_v2
SET production_phase = true,
    production_approved = true,
    updated_at = pg_catalog.clock_timestamp() - interval '31 seconds'
WHERE singleton;

SELECT private.run_quiz_deadline_clock_v2();

DO $$
DECLARE
  v_failure_count integer;
  v_gate_fresh boolean;
BEGIN
  SELECT
    health.last_failure_count,
    (health.last_summary ->> 'runtimeGateFresh')::boolean
  INTO v_failure_count, v_gate_fresh
  FROM public.quiz_deadline_clock_health_v2 AS health
  WHERE health.singleton;

  IF v_failure_count < 1 OR v_gate_fresh IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'stale runtime gate was reported healthy';
  END IF;
END;
$$;

ROLLBACK;
