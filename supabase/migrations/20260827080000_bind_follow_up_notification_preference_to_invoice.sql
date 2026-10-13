-- Bind the follow-up preference read to an existing invoice order. The
-- storefront only needs this bit after creating an invoice; it must not be
-- able to probe arbitrary merchant preference rows by UUID.
DROP FUNCTION IF EXISTS public.get_follow_up_notification_preference(uuid);

CREATE FUNCTION public.get_follow_up_notification_preference(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT COALESCE(preference.follow_up_notifications_enabled, TRUE)
      FROM public.orders AS invoice_order
      LEFT JOIN public.notification_preferences AS preference
        ON preference.merchant_id = invoice_order.merchant_id
      WHERE invoice_order.id = p_order_id
        AND invoice_order.payment_method = 'invoice'
        AND invoice_order.payment_status IS DISTINCT FROM 'paid'
    ),
    FALSE
  );
$$;

ALTER FUNCTION public.get_follow_up_notification_preference(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_follow_up_notification_preference(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_up_notification_preference(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_follow_up_notification_preference(uuid) IS
  'Returns the merchant follow-up alert switch only for an existing unpaid invoice order.';
