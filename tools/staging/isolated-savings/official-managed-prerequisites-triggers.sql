DO $triggers$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT trigger.evtname, trigger.evtevent, trigger.evttags, trigger.evtowner,
                     procedure.proname, procedure.prosrc, procedure.prosecdef, procedure.proconfig,
                     procedure.prorettype, procedure.proowner, procedure.pronargs, namespace.nspname, language.lanname
                FROM pg_event_trigger trigger JOIN pg_proc procedure ON procedure.oid = trigger.evtfoid
                JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
                JOIN pg_language language ON language.oid = procedure.prolang
               WHERE trigger.evtenabled <> 'D' LOOP
    IF item.evtname NOT IN ('issue_pg_cron_access','issue_pg_net_access')
       OR item.evtevent <> 'ddl_command_end' OR item.nspname <> 'extensions' OR item.lanname <> 'plpgsql'
       OR item.prosecdef OR item.proconfig IS NOT NULL OR item.pronargs <> 0 OR item.prorettype <> 'event_trigger'::regtype
       OR pg_get_userbyid(item.evtowner) NOT IN ('postgres','supabase_admin')
       OR pg_get_userbyid(item.proowner) NOT IN ('postgres','supabase_admin') THEN
      RAISE EXCEPTION 'Unreviewed event trigger definition';
    END IF;
    IF item.evtname = 'issue_pg_cron_access' AND (item.proname <> 'grant_pg_cron_access'
       OR item.evttags IS DISTINCT FROM ARRAY['CREATE SCHEMA']::text[] OR md5(item.prosrc) <> '5636ee89b1f4b7407f1712359246679f') THEN
      RAISE EXCEPTION 'Official cron trigger source mismatch';
    END IF;
    IF item.evtname = 'issue_pg_net_access' AND (item.proname <> 'grant_pg_net_access'
       OR item.evttags IS DISTINCT FROM ARRAY['CREATE EXTENSION']::text[] OR md5(item.prosrc) <> 'bc1b71101065a4eb19818ad9cd71a8bd') THEN
      RAISE EXCEPTION 'Official net trigger source mismatch';
    END IF;
    EXECUTE format('ALTER EVENT TRIGGER %I DISABLE', item.evtname);
  END LOOP;
END
$triggers$;
