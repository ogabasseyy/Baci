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
  WHERE id = NEW.order_id;
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
    AND public.manual_order_timezone(merchant_id) IS NOT NULL;

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
     OR NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders
  SET
    invoice_issue_date = CASE
      WHEN invoice_issue_date_generated IS TRUE
      THEN (NEW.transaction_date AT TIME ZONE v_time_zone)::date
      ELSE invoice_issue_date
    END,
    tax_point_date = CASE
      WHEN tax_point_date_generated IS TRUE
      THEN (NEW.transaction_date AT TIME ZONE v_time_zone)::date
      ELSE tax_point_date
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
