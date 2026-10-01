-- Serialize chat-order conversion with every other Paystack transaction
-- allocation path. `create_payment_transaction` and the manual partial
-- reconciliation RPC use the same reference-keyed advisory lock; the chat
-- conversion wrapper must claim that key before its private transaction
-- insert so concurrent webhook paths cannot create two captures.

CREATE OR REPLACE FUNCTION public.convert_chat_order_to_paid_order_with_inventory(
  p_chat_order_id uuid,
  p_gateway text,
  p_reference text,
  p_amount numeric,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF lower(trim(COALESCE(p_gateway, ''))) = 'paystack' THEN
    IF NULLIF(trim(COALESCE(p_reference, '')), '') IS NULL THEN
      RAISE EXCEPTION 'reference_required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(trim(p_reference), 0)
    );

    IF EXISTS (
      SELECT 1
        FROM public.transactions AS t
       WHERE lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
         AND t.gateway_reference = trim(p_reference)
    ) THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.chat_orders AS co
          JOIN public.orders AS o
            ON o.notes = 'Converted from chat order. Session: ' || co.session_id
          JOIN public.transactions AS t ON t.order_id = o.id
         WHERE co.id = p_chat_order_id
           AND co.status IN ('completed', 'processing')
           AND lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
           AND t.gateway_reference = trim(p_reference)
      ) THEN
        RAISE EXCEPTION 'paystack_reference_already_recorded';
      END IF;
    END IF;
  END IF;

  RETURN private.convert_chat_order_to_paid_order_with_inventory(
    p_chat_order_id,
    p_gateway,
    p_reference,
    p_amount,
    p_currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_chat_order_to_paid_order_with_inventory(
  uuid, text, text, numeric, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_chat_order_to_paid_order_with_inventory(
  uuid, text, text, numeric, text
) TO service_role;
