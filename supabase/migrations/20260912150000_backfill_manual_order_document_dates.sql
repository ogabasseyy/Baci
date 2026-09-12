-- Manual orders created before invoice_issue_date was persisted could have
-- trigger-generated document dates from the recording day. Replace only those
-- values that still match the order creation calendar day; explicit overrides
-- remain untouched because the schema has no provenance marker for them.
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
    ELSE 'UTC'
  END
  FROM public.merchants AS m
  WHERE m.id = p_merchant_id;
$$;

UPDATE public.orders
SET
  invoice_issue_date = (
    transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
  )::date,
  tax_point_date = CASE
    WHEN tax_point_date = created_at::date
      OR tax_point_date = (
        created_at AT TIME ZONE public.manual_order_timezone(merchant_id)
      )::date
    THEN (
      transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
    )::date
    ELSE tax_point_date
  END
WHERE recorded_by_user_id IS NOT NULL
  AND transaction_date IS NOT NULL
  AND (
    invoice_issue_date = created_at::date
    OR invoice_issue_date = (
      created_at AT TIME ZONE public.manual_order_timezone(merchant_id)
    )::date
  );

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
      WHEN invoice_issue_date = CURRENT_DATE
        OR invoice_issue_date = created_at::date
        OR invoice_issue_date = (
          created_at AT TIME ZONE public.manual_order_timezone(merchant_id)
        )::date
      THEN (
        transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
      )::date
      ELSE invoice_issue_date
    END,
    tax_point_date = CASE
      WHEN tax_point_date = CURRENT_DATE
        OR tax_point_date = created_at::date
        OR tax_point_date = (
          created_at AT TIME ZONE public.manual_order_timezone(merchant_id)
        )::date
      THEN (
        transaction_date AT TIME ZONE public.manual_order_timezone(merchant_id)
      )::date
      ELSE tax_point_date
    END
  WHERE id = NEW.order_id
    AND recorded_by_user_id IS NOT NULL
    AND transaction_date IS NOT NULL;

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
  IF NEW.recorded_by_user_id IS NULL
     OR NEW.transaction_date IS NULL
     OR NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders
  SET
    invoice_issue_date = CASE
      WHEN invoice_issue_date IS NULL
        OR (
          OLD.transaction_date IS NULL
          AND (
            invoice_issue_date = CURRENT_DATE
            OR invoice_issue_date = (OLD.created_at AT TIME ZONE v_time_zone)::date
            OR invoice_issue_date = (OLD.created_at AT TIME ZONE 'UTC')::date
          )
        )
        OR invoice_issue_date = (OLD.transaction_date AT TIME ZONE v_time_zone)::date
      THEN (NEW.transaction_date AT TIME ZONE v_time_zone)::date
      ELSE invoice_issue_date
    END,
    tax_point_date = CASE
      WHEN tax_point_date IS NULL
        OR (
          OLD.transaction_date IS NULL
          AND (
            tax_point_date = CURRENT_DATE
            OR tax_point_date = (OLD.created_at AT TIME ZONE v_time_zone)::date
            OR tax_point_date = (OLD.created_at AT TIME ZONE 'UTC')::date
          )
        )
        OR tax_point_date = (OLD.transaction_date AT TIME ZONE v_time_zone)::date
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
