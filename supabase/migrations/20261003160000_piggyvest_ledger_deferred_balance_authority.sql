BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
SET LOCAL search_path = pg_catalog;
-- No LOCK on pg_proc/pg_trigger: locking system catalogs requires a
-- superuser and the history-replay applier is not one. Migrations apply
-- single-threaded in both replay and deploy, so no concurrent DDL can
-- interleave with the baseline check below; the ledger-table locks still
-- serialize against concurrent DML.
LOCK TABLE piggyvest_savings_ledger.operations, piggyvest_savings_ledger.postings
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE checker oid := to_regprocedure('piggyvest_savings_ledger.check_balance()');
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR checker IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc routine JOIN pg_language language ON language.oid = routine.prolang
      WHERE routine.oid = checker AND pg_get_userbyid(routine.proowner) = 'postgres'
        AND NOT routine.prosecdef AND language.lanname = 'plpgsql'
        AND routine.prorettype = 'trigger'::regtype AND routine.pronargs = 0
        AND NOT routine.proleakproof AND routine.provolatile = 'v' AND routine.proparallel = 'u'
        AND routine.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']
        AND routine.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
        AND md5(routine.prosrc) = 'c857aa292294e0c115a273b1db0931f0'
    ) OR (SELECT count(*) FROM pg_trigger WHERE tgfoid = checker) <> 2
    OR EXISTS (
      SELECT 1 FROM pg_trigger trigger WHERE trigger.tgfoid = checker AND (
        NOT trigger.tgdeferrable OR NOT trigger.tginitdeferred OR trigger.tgenabled <> 'O'
        OR trigger.tgtype <> 5 OR trigger.tgconstraint = 0 OR trigger.tgisinternal
        OR trigger.tgnargs <> 0 OR trigger.tgargs <> ''::bytea OR trigger.tgqual IS NOT NULL
        OR NOT ((trigger.tgname = 'operations_balanced'
          AND trigger.tgrelid = 'piggyvest_savings_ledger.operations'::regclass)
          OR (trigger.tgname = 'postings_balanced'
          AND trigger.tgrelid = 'piggyvest_savings_ledger.postings'::regclass))
        OR pg_get_triggerdef(trigger.oid) IS DISTINCT FROM CASE trigger.tgname
          WHEN 'operations_balanced' THEN 'CREATE CONSTRAINT TRIGGER operations_balanced AFTER INSERT ON piggyvest_savings_ledger.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.check_balance()'
          WHEN 'postings_balanced' THEN 'CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON piggyvest_savings_ledger.postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION piggyvest_savings_ledger.check_balance()'
        END
      )
    ) THEN
    RAISE EXCEPTION 'ledger balance authority baseline refused' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE TEMP TABLE ledger_balance_authority_before ON COMMIT DROP AS
SELECT
  (SELECT to_jsonb(routine) - 'prosecdef' FROM pg_proc routine
    WHERE oid = 'piggyvest_savings_ledger.check_balance()'::regprocedure) AS routine,
  (SELECT jsonb_agg(to_jsonb(trigger) ORDER BY oid) FROM pg_trigger trigger
    WHERE tgfoid = 'piggyvest_savings_ledger.check_balance()'::regprocedure) AS triggers,
  (SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) ORDER BY oid)
    FROM pg_class WHERE oid IN ('piggyvest_savings_ledger.operations'::regclass,
      'piggyvest_savings_ledger.postings'::regclass)) AS relations;

ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY DEFINER;

DO $$
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc
      WHERE oid = 'piggyvest_savings_ledger.check_balance()'::regprocedure)
    OR EXISTS (
      SELECT 1 FROM ledger_balance_authority_before original WHERE
        original.routine IS DISTINCT FROM (SELECT to_jsonb(routine) - 'prosecdef'
          FROM pg_proc routine WHERE oid = 'piggyvest_savings_ledger.check_balance()'::regprocedure)
        OR original.triggers IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(trigger) ORDER BY oid)
          FROM pg_trigger trigger WHERE tgfoid = 'piggyvest_savings_ledger.check_balance()'::regprocedure)
        OR original.relations IS DISTINCT FROM (SELECT jsonb_agg(
          jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) ORDER BY oid)
          FROM pg_class WHERE oid IN ('piggyvest_savings_ledger.operations'::regclass,
            'piggyvest_savings_ledger.postings'::regclass))
    ) THEN
    RAISE EXCEPTION 'ledger balance authority postcondition refused' USING ERRCODE = '42501';
  END IF;
END $$;
COMMIT;
