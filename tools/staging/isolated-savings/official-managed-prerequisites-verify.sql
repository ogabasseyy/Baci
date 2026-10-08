DO $verify$
DECLARE
  result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['uuid-ossp','pgcrypto','pg_trgm','vector','pg_net','pg_cron','supabase_vault','pg_stat_statements']) required(name)
             WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = required.name)) THEN
    RAISE EXCEPTION 'Extension prerequisite verification failed';
  END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('net.http_request_queue') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'Official extension objects missing';
  END IF;
  IF to_regclass('extensions.pg_stat_statements') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements' AND extnamespace='extensions'::regnamespace AND extversion='1.11') THEN
    RAISE EXCEPTION 'Baseline statistics view prerequisite missing';
  END IF;
  IF EXISTS (SELECT 1 FROM vault.secrets) OR EXISTS (SELECT 1 FROM net.http_request_queue) OR EXISTS (SELECT 1 FROM cron.job) THEN
    RAISE EXCEPTION 'Vault, network queue and cron jobs must remain empty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('realtime.messages') AND relkind = 'p' AND relrowsecurity)
     OR to_regprocedure('realtime.topic()') IS NULL OR to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL
     OR to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Managed object verification failed';
  END IF;
  IF EXISTS (SELECT 1 FROM realtime.messages) THEN RAISE EXCEPTION 'Realtime messages must remain empty'; END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Event triggers must remain disabled for installer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables
                 AND pubinsert AND pubupdate AND pubdelete AND pubtruncate)
     OR EXISTS (SELECT 1 FROM pg_publication_rel JOIN pg_publication ON pg_publication.oid = prpubid WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'Publication must be empty with official publish options';
  END IF;
  PERFORM set_config('request.jwt.claim', '', true);
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  IF auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid THEN
    RAISE EXCEPTION 'Existing Auth helpers failed synthetic claims verification';
  END IF;
  result := graphql_public.graphql(query := '{ __typename }');
  IF result #>> '{errors,0,message}' IS DISTINCT FROM 'pg_graphql extension is not enabled.' THEN
    RAISE EXCEPTION 'Official disabled GraphQL entrypoint verification failed';
  END IF;
END
$verify$;
