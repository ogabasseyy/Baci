-- Refund audit surface (1/5): retry columns, the readable events
-- table with its policies, the write-time error-label helper, the
-- backfill, and the audit trigger. Later parts add the coverage
-- helper, the record helpers, the manager RPC, and public access.

-- Merchant commands use the same row lock as the cancellation worker.
ALTER TABLE public.order_cancellation_side_effects
  ADD COLUMN IF NOT EXISTS retry_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_by uuid,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

CREATE TABLE IF NOT EXISTS public.order_refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_refund_events_order_id_idx ON public.order_refund_events(order_id,created_at);
CREATE INDEX IF NOT EXISTS order_refund_events_merchant_id_idx ON public.order_refund_events(merchant_id);
ALTER TABLE public.order_refund_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_refund_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_refund_events TO authenticated;
GRANT ALL ON public.order_refund_events TO service_role;
CREATE POLICY merchant_refund_events_read ON public.order_refund_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid())
    OR public.check_staff_permission(auth.uid(),merchant_id,'orders','view'));
CREATE POLICY service_refund_events ON public.order_refund_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fixed labels for worker/provider strings stored in the readable
-- audit table. order_refund_events grants SELECT to authenticated
-- owners and view staff, so raw exception text must never land here:
-- direct REST readers bypass the route masking. Mirrors
-- describeRefundWorkerError branch for branch; raw text stays in the
-- service-role-only side_effects table. NULL stays NULL (no error).
CREATE OR REPLACE FUNCTION private.describe_refund_worker_error_v1(
  p_message text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_message IS NULL THEN NULL
    WHEN LEFT(p_message, 29) = 'cancellation_refund_awaiting_'
      THEN 'Refund in progress — waiting for the remaining money to arrive.'
    WHEN POSITION('requires review' IN lower(p_message)) > 0
      OR POSITION('review required' IN lower(p_message)) > 0
      OR POSITION('reconciliation' IN lower(p_message)) > 0
      THEN 'This refund needs review before it can continue.'
    ELSE 'The refund ran into a problem. Support has the details.'
  END;
$$;
REVOKE ALL ON FUNCTION private.describe_refund_worker_error_v1(text)
  FROM PUBLIC,anon,authenticated;
-- The audit trigger fires on service-role and definer writes; both
-- need EXECUTE (the Postgres 18 denial path segfaults instead of
-- raising 42501 — see capped_refund_coverage_v1). The private-schema
-- boundary stays USAGE-denied for authenticated, as the suite asserts.
GRANT EXECUTE ON FUNCTION private.describe_refund_worker_error_v1(text)
  TO service_role, authenticated;

INSERT INTO public.order_refund_events(order_id,merchant_id,action,details)
SELECT s.order_id,s.merchant_id,'existing_state',
  jsonb_build_object('status',s.status,'attempts',s.attempts,
    'error',private.describe_refund_worker_error_v1(s.error))
FROM public.order_cancellation_side_effects s WHERE s.step='refund'
  AND NOT EXISTS (SELECT 1 FROM public.order_refund_events e WHERE e.order_id=s.order_id);

CREATE OR REPLACE FUNCTION private.audit_order_refund_step()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.step='refund' THEN
    -- Error text is mapped to fixed labels at write time: this table
    -- is readable by authenticated staff, and route masking cannot
    -- protect direct REST readers. Raw text stays in side_effects.
    INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
    VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
      CASE WHEN TG_OP='UPDATE' AND NEW.retry_requests>OLD.retry_requests
        THEN 'retry_requested' ELSE NEW.status END,
      jsonb_build_object('attempts',NEW.attempts,
        'error',private.describe_refund_worker_error_v1(NEW.error),
        'retryRequests',NEW.retry_requests,
        'previousAttempts',CASE WHEN TG_OP='UPDATE' THEN OLD.attempts END,
        'previousError',CASE WHEN TG_OP='UPDATE'
          THEN private.describe_refund_worker_error_v1(OLD.error) END));
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.audit_order_refund_step() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS audit_order_refund_step ON public.order_cancellation_side_effects;
CREATE TRIGGER audit_order_refund_step AFTER INSERT OR UPDATE OF status,attempts,retry_requests
  ON public.order_cancellation_side_effects FOR EACH ROW EXECUTE FUNCTION private.audit_order_refund_step();
