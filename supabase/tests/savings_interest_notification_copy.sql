-- Contract test: the paid-interest notification copy helpers and their
-- privileges (migration 20261102214500_savings_interest_notification_copy).
-- Proves, against live PostgreSQL:
--   * progress_message(saved_kobo, target_kobo) returns a safe fallback for a
--     zero, negative, missing or non-finite target or saved amount, the same
--     neutral balance prompt (never a completion claim) once saved meets or
--     passes the target, a floored percentage below it, and the naira amount
--     left while progress is under 1%. Only the goal-completed notice, which
--     is voided when completion is reversed, may say the goal is reached;
--   * interest_progress(goal) returns the fallback for an unknown goal;
--   * the two notifiers stay SECURITY DEFINER, the two helpers stay
--     SECURITY INVOKER, and all four pin search_path;
--   * no API role (PUBLIC, anon, authenticated, service_role) can execute any
--     of them, asserted through the catalog only (a denied EXECUTE cannot be
--     trapped on the replay image, so no denial is probed by calling);
--   * each notifier is bound exactly once, as an AFTER INSERT row trigger on
--     the paid-interest table it watches, so accruals and reversals (other
--     tables) can never fire it;
--   * each notifier's owner, whom the helpers run as, can execute both
--     helpers and read every row of the tables the progress text reads.
-- Behaviour of the triggers is covered by
-- savings_interest_notification_triggers.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/savings_interest_notification_copy.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.progress(p_saved numeric, p_target numeric) RETURNS text
LANGUAGE sql AS $$
  SELECT savings_notifications.progress_message(p_saved, p_target)
$$;

-- 1. Signatures, security mode, volatility and pinned search_path.
DO $$
DECLARE
  v_expected record;
  v_proc regprocedure;
  v_role text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('piggyvest_primary.notify_paid_interest()', true, 'v'),
      ('savings_notifications.interest_recorded()', true, 'v'),
      ('savings_notifications.progress_message(numeric,numeric)', false, 's'),
      ('savings_notifications.interest_progress(uuid)', false, 'v')
    ) AS expected(signature, definer, volatility)
  LOOP
    v_proc := pg_catalog.to_regprocedure(v_expected.signature);
    PERFORM pg_temp.check(v_proc IS NOT NULL, v_expected.signature || ' is missing');
    PERFORM pg_temp.check(
      (SELECT p.prosecdef = v_expected.definer AND p.provolatile = v_expected.volatility
       FROM pg_catalog.pg_proc p WHERE p.oid = v_proc),
      v_expected.signature || ' has the wrong security mode or volatility');
    PERFORM pg_temp.check(
      (SELECT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS setting
         WHERE setting LIKE 'search_path=%')
       FROM pg_catalog.pg_proc p WHERE p.oid = v_proc),
      v_expected.signature || ' must pin search_path');
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(
        NOT pg_catalog.has_function_privilege(v_role, v_proc, 'EXECUTE'),
        v_role || ' must not execute ' || v_expected.signature);
    END LOOP;
  END LOOP;
END $$;

-- 2. Each notifier fires only on inserts into its paid-interest table.
-- tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update, 32 truncate,
-- 64 instead of.
DO $$
DECLARE v_expected record;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('piggyvest_primary.notify_paid_interest()', 'piggyvest_primary.paid_interest_receipts',
       'primary_paid_interest_notification'),
      ('savings_notifications.interest_recorded()', 'piggyvest_savings_ledger.postings',
       'customer_savings_engagement_interest')
    ) AS expected(signature, relation, trigger_name)
  LOOP
    PERFORM pg_temp.check(
      (SELECT count(*) = 1
         AND bool_and(t.tgrelid = pg_catalog.to_regclass(v_expected.relation)
           AND t.tgname = v_expected.trigger_name AND t.tgenabled = 'O'
           AND t.tgtype::integer & (1 | 4) = (1 | 4)
           AND t.tgtype::integer & (2 | 8 | 16 | 32 | 64) = 0)
       FROM pg_catalog.pg_trigger t
       WHERE t.tgfoid = pg_catalog.to_regprocedure(v_expected.signature) AND NOT t.tgisinternal),
      v_expected.signature || ' must be bound once, AFTER INSERT FOR EACH ROW on '
        || v_expected.relation);
  END LOOP;
END $$;

-- 3. A zero, negative, missing or non-finite amount never yields a percentage.
SELECT pg_temp.check(
  pg_temp.progress(v_case.saved, v_case.target) = 'Open your savings to see your latest balance.',
  'progress fallback expected for saved=' || coalesce(v_case.saved::text, 'NULL')
    || ' target=' || coalesce(v_case.target::text, 'NULL'))
FROM (VALUES
  (0::numeric, 0::numeric),
  (5000, 0),
  (NULL, 100000),
  (100000, NULL),
  (-1, 100000),
  (100, -5),
  ('NaN', 100000),
  (100, 'NaN'),
  ('Infinity', 100000),
  (100, 'Infinity'),
  ('-Infinity', 100000)
) AS v_case(saved, target);

-- 4. Meeting or passing the target never claims completion: a later reversal
-- can take the goal back below target, and nothing withdraws an interest
-- notice's text, so the copy points to the live balance instead.
SELECT pg_temp.check(
  pg_temp.progress(100000, 100000) = 'Open your savings to see your latest balance.',
  'saved equal to target must not claim the goal is reached');
SELECT pg_temp.check(
  pg_temp.progress(150000, 100000) = 'Open your savings to see your latest balance.',
  'saved above target must not claim the goal is reached or read above 100%');

-- 5. Below the target the percentage is floored, so 99.999% is not reached.
SELECT pg_temp.check(pg_temp.progress(35000, 100000) = 'You’re now 35% of the way there.',
  'a third of the way must read 35%');
SELECT pg_temp.check(pg_temp.progress(99999, 100000) = 'You’re now 99% of the way there.',
  'just under the target must floor to 99%');
SELECT pg_temp.check(pg_temp.progress(1000, 100000) = 'You’re now 1% of the way there.',
  'exactly 1% must read as a percentage');

-- 6. Under 1% the message names the naira amount left instead of "0%".
SELECT pg_temp.check(pg_temp.progress(50, 100000) = '₦999.50 left to reach your goal.',
  'under 1% must name the exact naira remainder');
SELECT pg_temp.check(pg_temp.progress(0, 100000) = '₦1,000.00 left to reach your goal.',
  'nothing saved must name the full target with grouping');

-- 7. An unknown goal falls back instead of raising.
SELECT pg_temp.check(
  savings_notifications.interest_progress('a7c00000-0000-4000-8000-0000000000ff')
    = 'Open your savings to see your latest balance.',
  'an unknown goal must fall back to the safe progress text');

-- 8. The SECURITY INVOKER helpers run as each SECURITY DEFINER notifier's
-- owner, and EXECUTE is revoked from PUBLIC, so that owner must be able to
-- execute both helpers and read, unfiltered by row security, every table
-- interest_progress reads. The notifiers also fall back to neutral text if
-- the progress text fails (savings_interest_notification_fallback.sql).
DO $$
DECLARE
  v_notifier text;
  v_owner oid;
  v_helper text;
  v_table text;
BEGIN
  FOREACH v_notifier IN ARRAY ARRAY['piggyvest_primary.notify_paid_interest()',
    'savings_notifications.interest_recorded()'] LOOP
    SELECT p.proowner INTO v_owner FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure(v_notifier);
    FOREACH v_helper IN ARRAY ARRAY['savings_notifications.interest_progress(uuid)',
      'savings_notifications.progress_message(numeric,numeric)'] LOOP
      PERFORM pg_temp.check(
        pg_catalog.has_function_privilege(v_owner, pg_catalog.to_regprocedure(v_helper), 'EXECUTE'),
        'the owner of ' || v_notifier || ' must be able to execute ' || v_helper);
    END LOOP;
    FOREACH v_table IN ARRAY ARRAY['public.customer_savings_goals',
      'piggyvest_savings_ledger.operations', 'piggyvest_savings_ledger.postings',
      'piggyvest_primary.paid_interest_receipts', 'piggyvest_primary.paid_interest_reversals',
      'piggyvest_primary.integrations'] LOOP
      PERFORM pg_temp.check(
        pg_catalog.has_table_privilege(v_owner, pg_catalog.to_regclass(v_table), 'SELECT')
          AND (SELECT role.rolsuper OR role.rolbypassrls OR NOT relation.relrowsecurity
                 OR (relation.relowner = v_owner AND NOT relation.relforcerowsecurity)
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_roles role ON role.oid = v_owner
               WHERE relation.oid = pg_catalog.to_regclass(v_table)),
        'the owner of ' || v_notifier || ' must read every row of ' || v_table);
    END LOOP;
  END LOOP;
END $$;

ROLLBACK;
