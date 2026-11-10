-- One-shot merchant alert ledger for cancellation refund reviews.
--
-- When a cancellation refund is filed for review
-- (reconciliation_review issue_type = order_cancellation_refund_requires_review)
-- the worker tells the merchant. The claim is an INSERT keyed by the review id:
-- the first insert wins and sends the alert, later drain retries hit the
-- primary key (23505) and stay silent. Deleting the review cascades the claim;
-- a new review for the same order is a new alert.
--
-- Server-only: no browser role can read or write it.

CREATE TABLE IF NOT EXISTS public.order_cancellation_refund_alerts (
  review_id uuid PRIMARY KEY
    REFERENCES public.reconciliation_review(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_cancellation_refund_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_cancellation_refund_alerts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.order_cancellation_refund_alerts
  TO service_role;

CREATE POLICY order_cancellation_refund_alerts_service_role
  ON public.order_cancellation_refund_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS order_cancellation_refund_alerts_order_idx
  ON public.order_cancellation_refund_alerts (order_id);
CREATE INDEX IF NOT EXISTS order_cancellation_refund_alerts_merchant_idx
  ON public.order_cancellation_refund_alerts (merchant_id);
