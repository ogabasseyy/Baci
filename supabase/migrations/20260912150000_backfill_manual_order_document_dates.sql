-- Manual orders created before invoice_issue_date was persisted could have
-- trigger-generated document dates from the recording day. Replace only those
-- values that still match the order creation calendar day; explicit overrides
-- remain untouched because the schema has no provenance marker for them.
UPDATE public.orders
SET
  invoice_issue_date = (transaction_date AT TIME ZONE 'Africa/Lagos')::date,
  tax_point_date = CASE
    WHEN tax_point_date = created_at::date
      OR tax_point_date = (created_at AT TIME ZONE 'Africa/Lagos')::date
    THEN (transaction_date AT TIME ZONE 'Africa/Lagos')::date
    ELSE tax_point_date
  END
WHERE recorded_by_user_id IS NOT NULL
  AND transaction_date IS NOT NULL
  AND (
    invoice_issue_date = created_at::date
    OR invoice_issue_date = (created_at AT TIME ZONE 'Africa/Lagos')::date
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
        OR invoice_issue_date = (created_at AT TIME ZONE 'Africa/Lagos')::date
      THEN (transaction_date AT TIME ZONE 'Africa/Lagos')::date
      ELSE invoice_issue_date
    END,
    tax_point_date = CASE
      WHEN tax_point_date = CURRENT_DATE
        OR tax_point_date = created_at::date
        OR tax_point_date = (created_at AT TIME ZONE 'Africa/Lagos')::date
      THEN (transaction_date AT TIME ZONE 'Africa/Lagos')::date
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
