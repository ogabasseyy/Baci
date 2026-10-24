-- Keep the active operator RPC aligned with the ChatGPT delivery destination.
-- Replace only its destination validation; preserve authorization, projections,
-- filters, function ownership, and existing execute privileges.
BEGIN;
DO $migration$
DECLARE
  definition text;
  needle constant text := $old$p_destination NOT IN ('facebook', 'tiktok', 'snapchat', 'ga4')$old$;
BEGIN
  SELECT pg_get_functiondef(
    'public.list_event_pipeline_deliveries_admin_v3(text,integer,integer,text,text,uuid,timestamptz,timestamptz)'::regprocedure
  ) INTO definition;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'Expected one active admin delivery destination guard';
  END IF;
  EXECUTE replace(definition,needle,
    $new$p_destination NOT IN ('facebook', 'tiktok', 'snapchat', 'ga4', 'chatgpt')$new$);
END
$migration$;
COMMIT;
