-- One-shot merchant alert ledger for cancellation refund reviews.
--
-- When a cancellation refund is filed for review
-- (reconciliation_review issue_type = order_cancellation_refund_requires_review)
-- the worker tells the merchant. The claim is an INSERT keyed by the review id:
-- the first insert wins and sends the alert, later drain retries hit the
-- primary key (23505) and stay silent. Deleting the review cascades the claim;
-- a new review for the same order is a new alert.
--
-- A claim whose send was uncertain (timeout, ambiguous provider result, worker
-- crash) stays unconfirmed (confirmed_at IS NULL). The listing RPC below
-- re-drives such rows after a cool-down, capped at p_max_attempts, and returns
-- never-claimed reviews first-class, so already-alerted reviews can never
-- crowd the scan limit. Every attempt, delivered or not, keeps its row, so a
-- persistently undeliverable review hits the cool-down and cap instead of
-- looping.
--
-- Server-only: no browser role can read or write it.

CREATE TABLE IF NOT EXISTS public.order_cancellation_refund_alerts (
  review_id uuid PRIMARY KEY
    REFERENCES public.reconciliation_review(id) ON DELETE CASCADE,
  order_id uuid NOT NULL
    REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL
    REFERENCES public.merchants(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  -- Set when neither push nor email was available. Attempts are NOT consumed;
  -- the review is re-checked after a long cool-down until it leaves the
  -- lookback window, so a merchant who later adds an email still gets alerted.
  undeliverable_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_cancellation_refund_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_cancellation_refund_alerts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_cancellation_refund_alerts
  TO service_role;

DROP POLICY IF EXISTS order_cancellation_refund_alerts_service_role
  ON public.order_cancellation_refund_alerts;
CREATE POLICY order_cancellation_refund_alerts_service_role
  ON public.order_cancellation_refund_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS order_cancellation_refund_alerts_order_idx
  ON public.order_cancellation_refund_alerts (order_id);
CREATE INDEX IF NOT EXISTS order_cancellation_refund_alerts_merchant_idx
  ON public.order_cancellation_refund_alerts (merchant_id);

-- Open cancellation-refund reviews that still need a merchant alert: never
-- claimed, or claimed but unconfirmed after the cool-down with attempts left.
-- The anti-join happens before the limit, so alerted reviews cannot starve
-- older unalerted ones. SECURITY INVOKER: only service_role can run it.
CREATE OR REPLACE FUNCTION public.list_cancellation_refund_reviews_needing_alert_v1(
  p_since timestamptz,
  p_retry_before timestamptz,
  p_max_attempts integer,
  p_limit integer,
  p_undeliverable_before timestamptz
)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  merchant_id uuid,
  candidates jsonb,
  metadata jsonb,
  alert_attempts integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT r.id, r.order_id, r.merchant_id, r.candidates, r.metadata, a.attempts
  FROM public.reconciliation_review r
  -- Un-alertable reviews (no order, no merchant, or order/merchant mismatch)
  -- are excluded before the limit so they never occupy scan slots.
  JOIN public.orders o ON o.id = r.order_id AND o.merchant_id = r.merchant_id
  LEFT JOIN public.order_cancellation_refund_alerts a ON a.review_id = r.id
  WHERE r.issue_type = 'order_cancellation_refund_requires_review'
    AND r.resolved_at IS NULL
    AND r.created_at >= p_since
    AND (
      a.review_id IS NULL
      OR (
        a.confirmed_at IS NULL
        AND a.undeliverable_at IS NULL
        AND a.attempts < p_max_attempts
        AND a.last_attempt_at <= p_retry_before
      )
      OR (
        a.confirmed_at IS NULL
        AND a.undeliverable_at IS NOT NULL
        AND a.undeliverable_at <= p_undeliverable_before
      )
    )
  -- Never-attempted reviews first, oldest first (closest to aging out of the
  -- lookback), then cooled-down retries and long-cool-down undeliverables,
  -- newest first.
  ORDER BY
    (a.review_id IS NOT NULL),
    CASE WHEN a.review_id IS NULL THEN r.created_at END ASC,
    r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.list_cancellation_refund_reviews_needing_alert_v1(
  timestamptz, timestamptz, integer, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_cancellation_refund_reviews_needing_alert_v1(
  timestamptz, timestamptz, integer, integer, timestamptz
) TO service_role;
