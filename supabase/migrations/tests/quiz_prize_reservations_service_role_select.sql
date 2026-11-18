BEGIN;

DO $$
BEGIN
  IF to_regclass('public.quiz_prize_reservations') IS NULL THEN
    RAISE EXCEPTION 'quiz_prize_reservations missing';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'service_role',
    'public.quiz_prize_reservations',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'service_role SELECT grant on quiz_prize_reservations missing';
  END IF;

  IF pg_catalog.has_table_privilege(
    'service_role',
    'public.quiz_prize_reservations',
    'INSERT, UPDATE, DELETE'
  ) THEN
    RAISE EXCEPTION 'service_role write privileges on quiz_prize_reservations should remain revoked';
  END IF;

  IF pg_catalog.has_table_privilege(
    'anon',
    'public.quiz_prize_reservations',
    'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'public.quiz_prize_reservations',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'player roles must not have SELECT on quiz_prize_reservations';
  END IF;
END;
$$;

ROLLBACK;
