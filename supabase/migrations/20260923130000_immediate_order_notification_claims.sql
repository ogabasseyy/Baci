-- Atomic pending/sent claim for immediate order notifications
-- (invoice / Pay on Delivery / Pay for Me / wallet-or-voucher-paid).
--
-- The orders route sends the payment document / payer handoff in a
-- fire-and-forget after() callback AFTER the creation response. If the
-- process terminates, after() is interrupted, or the email provider fails,
-- the order already exists but the notification may never be delivered —
-- and an idempotent retry (same idempotency key) historically suppressed
-- the only notification attempt via `idempotencyReplayed`, leaving the
-- customer without the document forever.
--
-- This table lets the route claim delivery atomically and lets replays
-- resume unfinished work: the winner of the claim runs after() delivery;
-- losers skip while delivery is fresh, and any replay reclaims a failed
-- or stale (crashed-mid-send) claim. Exactly-once per order in the common
-- cases, at-least-once across crashes — never silent loss.
--
-- Follows the order_notification_outbox precedent: service-role-only
-- writes through SECURITY DEFINER claim/complete RPCs, RLS denying anon
-- and authenticated outright.

CREATE TABLE IF NOT EXISTS public.immediate_order_notification_claims (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.immediate_order_notification_claims ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.immediate_order_notification_claims
  TO service_role;

DROP POLICY IF EXISTS immediate_order_notification_claims_deny_public
  ON public.immediate_order_notification_claims;
CREATE POLICY immediate_order_notification_claims_deny_public
  ON public.immediate_order_notification_claims
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Atomically takes ownership of an order's immediate notification.
-- Ensures a pending row, then transitions pending/failed (or processing
-- whose lock predates the crash window — the previous owner died
-- mid-send) to processing. Returns claimed=true only for the winner.
-- A fresh (non-stale) processing row means another attempt is actively
-- delivering: the caller must skip, not double-send.
CREATE OR REPLACE FUNCTION public.claim_immediate_order_notification(
  p_order_id uuid
)
RETURNS TABLE (
  claimed boolean,
  claim_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  INSERT INTO public.immediate_order_notification_claims AS c
    (order_id, merchant_id, status)
  SELECT
    p_order_id,
    o.merchant_id,
    'pending'
  FROM public.orders AS o
  WHERE o.id = p_order_id
  ON CONFLICT (order_id) DO NOTHING;

  UPDATE public.immediate_order_notification_claims AS c
  SET
    status = 'processing',
    attempt_count = c.attempt_count + 1,
    locked_at = now(),
    last_error = NULL,
    updated_at = now()
  WHERE c.order_id = p_order_id
    AND (
      c.status IN ('pending', 'failed')
      OR (
        c.status = 'processing'
        AND c.locked_at IS NOT NULL
        AND c.locked_at < now() - interval '5 minutes'
      )
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN QUERY SELECT true, 'processing'::text;
  ELSE
    RETURN QUERY
      SELECT
        false,
        COALESCE(
          (
            SELECT c.status
            FROM public.immediate_order_notification_claims AS c
            WHERE c.order_id = p_order_id
          ),
          'unknown'
        );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_immediate_order_notification(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_immediate_order_notification(uuid)
  TO service_role;

COMMENT ON FUNCTION public.claim_immediate_order_notification(uuid) IS
  'Atomic delivery claim for immediate order notifications: ensures a pending row for the order, then takes ownership (pending/failed/stale-processing to processing). Only the claimed caller may run after() delivery; replays reclaim failed or crashed claims. Used by POST /api/orders for sessionless-safe resume.';

-- Records the delivery outcome. Sent is terminal (replays skip); failed
-- releases the claim for the next replay to resume.
CREATE OR REPLACE FUNCTION public.complete_immediate_order_notification(
  p_order_id uuid,
  p_sent boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.immediate_order_notification_claims AS c
  SET
    status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_sent THEN now() ELSE c.sent_at END,
    updated_at = now()
  WHERE c.order_id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.complete_immediate_order_notification(uuid, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_immediate_order_notification(uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.complete_immediate_order_notification(uuid, boolean) IS
  'Records immediate order notification delivery: sent (terminal, replays skip) or failed (releasable, the next replay resumes). Used by POST /api/orders after() delivery.';
