-- Fee-bearing captures support equal swaps and full cancellation. Reserve
-- upgrades and downgrades until partial fee coverage is qualified.
CREATE OR REPLACE FUNCTION private.add_paid_order_amendment_quote_options(p_quote jsonb,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF (p_quote->>'adjustmentMinor')::bigint <> 0 AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = (p_quote->>'captureId')::uuid AND t.order_id = p_order_id
      AND t.gateway_response ? 'baci_paystack_checkout_customer_fee_minor'
  ) THEN RAISE EXCEPTION 'scenario_disabled'; END IF;
  RETURN (SELECT p_quote || jsonb_build_object(
    'beforeLine',(p_quote->'beforeLine') || jsonb_build_object('variantName',i.variant_name),
    'afterLine',(p_quote->'afterLine') || jsonb_build_object('variantName',(
      SELECT string_agg(value,' / ' ORDER BY key)
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(v.attributes) = 'object'
        THEN v.attributes ELSE '{}'::jsonb END)
      WHERE NULLIF(btrim(value),'') IS NOT NULL
    ))
  )
  FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
  LEFT JOIN public.product_variants v ON v.id = (p_quote#>>'{afterLine,variantId}')::uuid
    AND v.merchant_id = o.merchant_id AND v.product_id = (p_quote#>>'{afterLine,productId}')::uuid
  WHERE i.order_id = p_order_id AND i.id = (p_quote#>>'{beforeLine,id}')::uuid);
END;
$$;
