-- Notification worker wrappers (4/4): grants and PostgREST request-scope allowlist.
-- Only gigl_tracking_worker can execute the wrappers; the grants come after every
-- function definition above.

ALTER FUNCTION public.gigl_worker_claim_notifications(integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_claim_notifications(integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_claim_notifications(integer, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_begin_notification_dispatch(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_begin_notification_dispatch(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_begin_notification_dispatch(uuid, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_complete_notification(uuid, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_complete_notification(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_complete_notification(uuid, text, text, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_notification_event(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_notification_event(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_notification_event(uuid, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_notification_customer(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_notification_customer(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_notification_customer(uuid, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_notification_push_tokens(uuid, text, uuid[], integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_notification_push_tokens(uuid, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_notification_push_tokens(uuid, text, uuid[], integer)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_record_notification_push_attempt(uuid, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_record_notification_push_attempt(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_record_notification_push_attempt(uuid, text, jsonb)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_store_notification_push_tickets(uuid, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_store_notification_push_tickets(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_store_notification_push_tickets(uuid, text, jsonb)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_deactivate_notification_push_tokens(uuid, text, text, text[])
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_deactivate_notification_push_tokens(uuid, text, text, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_deactivate_notification_push_tokens(uuid, text, text, text[])
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_notification_activation_candidates(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_notification_activation_candidates(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_notification_activation_candidates(uuid, text)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_claim_activation_reminder(uuid, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_claim_activation_reminder(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_claim_activation_reminder(uuid, text, uuid)
  TO gigl_tracking_worker;

ALTER FUNCTION public.gigl_worker_release_activation_reminders(uuid, text, uuid[])
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_release_activation_reminders(uuid, text, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_release_activation_reminders(uuid, text, uuid[])
  TO gigl_tracking_worker;

-- Extend the worker's PostgREST path allowlist, preserving every other
-- branch of the installed request guard verbatim (same technique as the
-- webhook-expedite migration). Only an existing role's allowlist grows, so
-- the change is live at commit; until the new code deploys nothing calls
-- these paths.
DO $guard$
DECLARE
  definition text := pg_get_functiondef(
    'public.enforce_gigl_tracking_worker_request_scope()'::regprocedure
  );
  anchor text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',';
  insertion text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',
        ''/rpc/gigl_worker_claim_notifications'',
        ''/rpc/gigl_worker_begin_notification_dispatch'',
        ''/rpc/gigl_worker_complete_notification'',
        ''/rpc/gigl_worker_notification_event'',
        ''/rpc/gigl_worker_notification_customer'',
        ''/rpc/gigl_worker_notification_push_tokens'',
        ''/rpc/gigl_worker_record_notification_push_attempt'',
        ''/rpc/gigl_worker_store_notification_push_tickets'',
        ''/rpc/gigl_worker_deactivate_notification_push_tokens'',
        ''/rpc/gigl_worker_notification_activation_candidates'',
        ''/rpc/gigl_worker_claim_activation_reminder'',
        ''/rpc/gigl_worker_release_activation_reminders'',';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles AS role_record, unnest(role_record.rolconfig) AS setting
    WHERE role_record.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('''/rpc/gigl_worker_claim_notifications''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;

NOTIFY pgrst, 'reload schema';
