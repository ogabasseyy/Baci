-- Project transaction acknowledgements from the authenticated callback inbox.
-- The inbox already deduplicates each typed reference per partner and environment.
CREATE INDEX oxygen_callback_repayment_receipts_idx
  ON oxygen_private.callback_inbox (
    partner_reference, environment, (event->>'bookedLoanReference'), received_at DESC, id
  )
  WHERE event->>'kind' = 'transaction'
    AND deduplication_key = 'transaction-loan_repayment:' || (event->>'transactionReference');

CREATE FUNCTION public.oxygen_order_repayment_receipts(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('id', i.id, 'recordedAt', i.received_at)
    ORDER BY i.received_at DESC, i.id
  ), '[]'::jsonb)
  FROM public.oxygen_workflows AS w
  JOIN public.orders AS o
    ON o.id = w.order_id AND o.merchant_id = w.merchant_id
    AND o.customer_id = w.customer_id
  JOIN public.customers AS c
    ON c.id = w.customer_id AND c.merchant_id = w.merchant_id
  JOIN oxygen_private.runtime_bindings AS b
    ON b.merchant_id = w.merchant_id AND b.environment = w.environment AND b.enabled
  JOIN oxygen_private.provider_states AS s ON s.workflow_id = w.id
  JOIN oxygen_private.callback_inbox AS i
    ON i.partner_reference = b.partner_reference AND i.environment = w.environment
    AND i.event->>'bookedLoanReference' = s.state->>'bookingReference'
  WHERE w.order_id = p_order_id
    AND c.user_id = (SELECT auth.uid())
    AND w.stage = 'activated'
    AND s.state#>>'{booking,status}' = 'ACTIVATED'
    AND i.event->>'kind' = 'transaction'
    AND nullif(i.event->>'transactionReference', '') IS NOT NULL
    AND i.deduplication_key = 'transaction-loan_repayment:' || (i.event->>'transactionReference')
    AND i.event->>'providerAmountSent' ~ '^[0-9]{1,32}([.][0-9]{1,2})?$'
    AND i.event->>'providerAmountSent' ~ '[1-9]'
$$;

REVOKE ALL ON FUNCTION public.oxygen_order_repayment_receipts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_order_repayment_receipts(uuid) TO authenticated;
