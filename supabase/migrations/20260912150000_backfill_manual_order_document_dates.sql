ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_issue_date_generated boolean,
  ADD COLUMN IF NOT EXISTS tax_point_date_generated boolean;

CREATE OR REPLACE FUNCTION public.manual_order_timezone(p_merchant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE upper(COALESCE(m.country, ''))
    WHEN 'GH' THEN 'Africa/Accra'
    WHEN 'GHANA' THEN 'Africa/Accra'
    WHEN 'KE' THEN 'Africa/Nairobi'
    WHEN 'KENYA' THEN 'Africa/Nairobi'
    WHEN 'NG' THEN 'Africa/Lagos'
    WHEN 'NIGERIA' THEN 'Africa/Lagos'
    WHEN 'ZA' THEN 'Africa/Johannesburg'
    WHEN 'SOUTH AFRICA' THEN 'Africa/Johannesburg'
    ELSE NULL
  END
  FROM public.merchants AS m
  WHERE m.id = p_merchant_id;
$$;

-- The new provenance columns are NULL for every pre-existing row, which would
-- make the backfill below a no-op. Two shapes are safe to record as generated:
-- NULL dates (mirroring the order_items trigger), and manual-origin rows whose
-- non-NULL dates were stamped as the recording day by update_order_tax_totals
-- (the released app never sent document dates, so these are never human
-- picks). Manual channels mirror the mobile-admin new-order CHANNELS plus the
-- legacy 'manual'/'staff_entry' markers. Proven-import rows (import_job_id or
-- external_source markers) are included too: the totals trigger stamped their
-- document dates as the import day while transaction_date kept the historical
-- sale instant. All other non-NULL dates keep NULL provenance and stay
-- untouched. Each flag initializes only from NULL so re-applying this
-- migration preserves explicit FALSE values (replay-safe).
-- Preserve order recency while backfilling. This migration is
-- transactional, so a failed UPDATE rolls back the temporary trigger state.
-- The customer-stats trigger is paused too: the backfill changes no order
-- totals, so recounting customers would only churn their OCC timestamps.
ALTER TABLE public.orders DISABLE TRIGGER "update_orders_updated_at";
ALTER TABLE public.orders DISABLE TRIGGER "update_customer_stats_trigger";
UPDATE public.orders
SET
  invoice_issue_date_generated = CASE
    WHEN invoice_issue_date IS NULL THEN true
    WHEN invoice_issue_date_generated IS NULL
     AND (source IN ('manual', 'staff_entry', 'physical', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga') OR import_job_id IS NOT NULL OR external_source IS NOT NULL) THEN true
    ELSE invoice_issue_date_generated
  END,
  tax_point_date_generated = CASE
    WHEN tax_point_date IS NULL THEN true
    WHEN tax_point_date_generated IS NULL
     AND (source IN ('manual', 'staff_entry', 'physical', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga') OR import_job_id IS NOT NULL OR external_source IS NOT NULL) THEN true
    ELSE tax_point_date_generated
  END
WHERE invoice_issue_date IS NULL OR tax_point_date IS NULL
   OR source IN ('manual', 'staff_entry', 'physical', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'jumia', 'jiji', 'konga') OR import_job_id IS NOT NULL OR external_source IS NOT NULL;

-- Rows without recorded provenance are intentionally left untouched. Date
-- equality cannot distinguish a generated date from an explicit override.
UPDATE public.orders
SET
  invoice_issue_date = CASE
    WHEN invoice_issue_date_generated IS TRUE
      AND manual_order_timezone(merchant_id) IS NOT NULL
    THEN (transaction_date AT TIME ZONE manual_order_timezone(merchant_id))::date
    ELSE invoice_issue_date
  END,
  tax_point_date = CASE
    WHEN tax_point_date_generated IS TRUE
      AND manual_order_timezone(merchant_id) IS NOT NULL
    THEN (transaction_date AT TIME ZONE manual_order_timezone(merchant_id))::date
    ELSE tax_point_date
  END
WHERE transaction_date IS NOT NULL
  AND (invoice_issue_date_generated IS TRUE OR tax_point_date_generated IS TRUE);
ALTER TABLE public.orders ENABLE TRIGGER "update_customer_stats_trigger";
ALTER TABLE public.orders ENABLE TRIGGER "update_orders_updated_at";

CREATE OR REPLACE FUNCTION public.mark_generated_manual_order_document_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  UPDATE public.orders
  SET
    invoice_issue_date_generated = CASE WHEN invoice_issue_date IS NULL THEN true ELSE invoice_issue_date_generated END,
    tax_point_date_generated = CASE WHEN tax_point_date IS NULL THEN true ELSE tax_point_date_generated END
  WHERE id = NEW.order_id
    AND (invoice_issue_date IS NULL OR tax_point_date IS NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_mark_generated_manual_order_document_dates ON public.order_items;
CREATE TRIGGER zz_mark_generated_manual_order_document_dates
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.mark_generated_manual_order_document_dates();

CREATE OR REPLACE FUNCTION public.correct_manual_order_document_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  UPDATE public.orders
  SET
    invoice_issue_date = CASE
      WHEN invoice_issue_date_generated IS TRUE
      THEN (
        transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
      )::date
      ELSE invoice_issue_date
    END,
    tax_point_date = CASE
      WHEN tax_point_date_generated IS TRUE
      THEN (
        transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
      )::date
      ELSE tax_point_date
    END
  WHERE id = NEW.order_id
    AND transaction_date IS NOT NULL
    AND public.manual_order_timezone(merchant_id) IS NOT NULL
    AND (
      (
        invoice_issue_date_generated IS TRUE
        AND invoice_issue_date IS DISTINCT FROM (
          transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
        )::date
      )
      OR (
        tax_point_date_generated IS TRUE
        AND tax_point_date IS DISTINCT FROM (
          transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
        )::date
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_correct_manual_order_document_dates
  ON public.order_items;
CREATE TRIGGER zz_correct_manual_order_document_dates
AFTER INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.correct_manual_order_document_dates();

CREATE OR REPLACE FUNCTION public.sync_manual_order_document_dates_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_time_zone text := public.manual_order_timezone(NEW.merchant_id);
BEGIN
  IF NEW.transaction_date IS NULL
     OR NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date
     OR v_time_zone IS NULL THEN
    RETURN NEW;
  END IF;

  -- A date changed in the same statement as the transaction is an explicit
  -- override: keep it and clear its flag atomically so later transaction
  -- updates cannot replace it.
  UPDATE public.orders
  SET
    invoice_issue_date = CASE
      WHEN NEW.invoice_issue_date IS DISTINCT FROM OLD.invoice_issue_date
      THEN NEW.invoice_issue_date
      WHEN invoice_issue_date_generated IS TRUE
      THEN (NEW.transaction_date AT TIME ZONE v_time_zone)::date
      ELSE invoice_issue_date
    END,
    invoice_issue_date_generated = CASE
      WHEN NEW.invoice_issue_date IS DISTINCT FROM OLD.invoice_issue_date
      THEN false
      ELSE invoice_issue_date_generated
    END,
    tax_point_date = CASE
      WHEN NEW.tax_point_date IS DISTINCT FROM OLD.tax_point_date
      THEN NEW.tax_point_date
      WHEN tax_point_date_generated IS TRUE
      THEN (NEW.transaction_date AT TIME ZONE v_time_zone)::date
      ELSE tax_point_date
    END,
    tax_point_date_generated = CASE
      WHEN NEW.tax_point_date IS DISTINCT FROM OLD.tax_point_date
      THEN false
      ELSE tax_point_date_generated
    END
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_sync_manual_order_document_dates_on_update
  ON public.orders;
CREATE TRIGGER zz_sync_manual_order_document_dates_on_update
AFTER UPDATE OF transaction_date ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_manual_order_document_dates_on_update();
