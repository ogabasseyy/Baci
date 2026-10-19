COMMENT ON FUNCTION public.get_admin_platform_analytics(text) IS
  'Platform analytics. Selected-period order summaries, daily breakdowns, and merchant sales recency use public.orders.created_at with the order payment status as currently recorded. They are order-created-time analytics, not payment-recorded-time analytics; paid_at completeness has not been established.';
