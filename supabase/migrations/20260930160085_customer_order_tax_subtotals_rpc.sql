-- Expose only the tax-subtotal fields required by customer documents.
-- The base table is merchant/staff-readable, so customer sessions must use
-- this ownership-checked projection instead of relying on its table policy:
-- without it the storefront availability gate validates an empty set and
-- advertises invoices the email sender rejects as tax_breakdown_invalid.
CREATE OR REPLACE FUNCTION public.get_customer_order_tax_subtotals(
  p_order_ids uuid[]
)
RETURNS TABLE (
  order_id uuid,
  vat_category_code text,
  vat_rate numeric,
  taxable_amount numeric,
  tax_amount numeric,
  exemption_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    subtotal.order_id,
    subtotal.vat_category_code,
    subtotal.vat_rate,
    subtotal.taxable_amount,
    subtotal.tax_amount,
    subtotal.exemption_reason
  FROM public.order_tax_subtotals AS subtotal
  INNER JOIN public.orders AS order_row ON order_row.id = subtotal.order_id
  INNER JOIN public.customers AS customer ON customer.id = order_row.customer_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND customer.user_id = (SELECT auth.uid())
    AND coalesce(array_length(p_order_ids, 1), 0) <= 100
    AND subtotal.order_id = ANY(coalesce(p_order_ids, ARRAY[]::uuid[]))
  ORDER BY subtotal.order_id, subtotal.vat_category_code;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_tax_subtotals(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_tax_subtotals(uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.get_customer_order_tax_subtotals(uuid[])
  IS 'Returns an ownership-checked tax-subtotal projection for customer documents.';
