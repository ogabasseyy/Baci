-- Aggregate-only monitoring stays independent of the bounded recovery list.
-- A fresh dispatch is allowed time to finish before it becomes actionable.
CREATE INDEX immediate_notification_unresolved_dispatch_idx
  ON private.immediate_notification_dispatches (updated_at)
  WHERE state = 'dispatching';

CREATE FUNCTION public.has_immediate_notification_reconciliation_backlog()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM private.immediate_notification_dispatches d
    LEFT JOIN public.immediate_order_notification_claims c ON c.order_id = d.order_id
    WHERE (d.state = 'dispatching' AND d.updated_at < now() - interval '5 minutes')
      OR (d.state = 'accepted' AND (c.claim_token IS DISTINCT FROM d.claim_token
        OR c.merchant_id IS DISTINCT FROM d.merchant_id OR c.status NOT IN ('processing', 'sent')))
  );
END $$;
REVOKE ALL ON FUNCTION public.has_immediate_notification_reconciliation_backlog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_immediate_notification_reconciliation_backlog()
  TO immediate_notification_redrive;

DO $guard$
DECLARE
  definition text := pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure);
  anchor text := '''/rpc/list_immediate_notification_recovery_candidates''';
  insertion text := '''/rpc/list_immediate_notification_recovery_candidates'', ''/rpc/has_immediate_notification_reconciliation_backlog''';
BEGIN
  IF position('immediate_notification_redrive_request_scope_v1' IN definition) = 0
    OR (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'unexpected redrive request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
