-- Sync document dates on a transaction-review date correction,
-- extracted from 20260930160600 (300-line rule). Runs with the
-- caller’s rights (SECURITY INVOKER) so row visibility matches the
-- review RPC exactly: no privilege change, only relocation. Lives in
-- public (not private) because authenticated has no USAGE on the private
-- schema; grants mirror the review RPC itself.
CREATE OR REPLACE FUNCTION public.sync_transaction_review_document_dates(
  p_order_id uuid,
  p_merchant_id uuid,
  p_transaction_date timestamptz,
  p_time_zone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_day_changed boolean := false;
  v_is_manual_order boolean := false;
  v_order_rows integer;
BEGIN
  -- A transaction review is an explicit human date correction: when the
  -- reviewer changes the calendar day, the transaction date follows the
  -- reviewer's selected day (client timezone, defaulting to Africa/Lagos
  -- above). Manual-origin orders derive their document dates from the same
  -- picker selection, so both dates follow and stay explicit (FALSE);
  -- without this the receipt would keep showing the original day. For
  -- non-manual orders only generated (TRUE-flag) dates follow; explicit or
  -- unknown-provenance dates (e.g. an already-issued invoice differing
  -- from the sale day) are preserved so a sale-date correction cannot
  -- silently rewrite them.
  -- Compare calendar days, not instants: the editor always re-serializes the
  -- date field as reviewer-local midnight, so the instant normally differs
  -- even for cost-only edits. When the day is unchanged the whole date block
  -- (including the stored instant) is preserved as-is.
  SELECT (
    transaction_date AT TIME ZONE p_time_zone
  )::date IS DISTINCT FROM (
    p_transaction_date AT TIME ZONE p_time_zone
  )::date,
    source IN ('manual', 'staff_entry', 'physical', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga')
  INTO v_day_changed, v_is_manual_order
  FROM public.orders
  WHERE id = p_order_id
    AND merchant_id = p_merchant_id;

  UPDATE public.orders
  SET transaction_date = CASE
        WHEN v_day_changed THEN p_transaction_date ELSE transaction_date END,
      invoice_issue_date = CASE
        WHEN v_day_changed
         AND (v_is_manual_order OR invoice_issue_date_generated IS TRUE)
        THEN (p_transaction_date AT TIME ZONE p_time_zone)::date
        ELSE invoice_issue_date
      END,
      tax_point_date = CASE
        WHEN v_day_changed
         AND (v_is_manual_order OR tax_point_date_generated IS TRUE)
        THEN (p_transaction_date AT TIME ZONE p_time_zone)::date
        ELSE tax_point_date
      END,
      invoice_issue_date_generated = CASE
        WHEN v_day_changed
         AND (v_is_manual_order OR invoice_issue_date_generated IS TRUE)
        THEN false ELSE invoice_issue_date_generated END,
      tax_point_date_generated = CASE
        WHEN v_day_changed
         AND (v_is_manual_order OR tax_point_date_generated IS TRUE)
        THEN false ELSE tax_point_date_generated END
  WHERE id = p_order_id
    AND merchant_id = p_merchant_id;

  GET DIAGNOSTICS v_order_rows = ROW_COUNT;

  IF v_order_rows = 0 THEN
    RAISE EXCEPTION 'Transaction not found for this merchant'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_transaction_review_document_dates(uuid, uuid, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_transaction_review_document_dates(uuid, uuid, timestamptz, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
