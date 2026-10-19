-- Install a fail-closed publication interlock before the first deadline cron
-- job can be scheduled. Later migrations replace the runner, but this guard
-- keeps the replay window incapable of awarding or publishing live prizes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quiz_runtime_control_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  production_phase boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

INSERT INTO public.quiz_runtime_control_v2(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.quiz_runtime_control_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role reads quiz runtime control v2"
  ON public.quiz_runtime_control_v2;
CREATE POLICY "service role reads quiz runtime control v2"
  ON public.quiz_runtime_control_v2
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE public.quiz_runtime_control_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quiz_runtime_control_v2 TO service_role;

CREATE OR REPLACE FUNCTION private.guard_live_quiz_result_publication_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate_open boolean := false;
BEGIN
  IF NEW.contract_version <> 2
    OR NEW.mode <> 'live'
    OR OLD.results_published_at IS NOT NULL
    OR NEW.results_published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    control.production_phase IS TRUE
      AND control.production_approved IS TRUE
      AND control.updated_at >=
        pg_catalog.clock_timestamp() - interval '30 seconds'
  INTO v_gate_open
  FROM public.quiz_runtime_control_v2 AS control
  WHERE control.singleton;

  IF COALESCE(v_gate_open, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'quiz_live_publication_runtime_gate_closed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_live_quiz_result_publication_v2
  ON public.quiz_events;
CREATE TRIGGER guard_live_quiz_result_publication_v2
BEFORE UPDATE OF results_published_at ON public.quiz_events
FOR EACH ROW
EXECUTE FUNCTION private.guard_live_quiz_result_publication_v2();

ALTER FUNCTION private.guard_live_quiz_result_publication_v2()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_live_quiz_result_publication_v2()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
