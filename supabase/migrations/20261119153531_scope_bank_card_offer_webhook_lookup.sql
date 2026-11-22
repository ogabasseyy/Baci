-- Resolve signed Paystack events through the saved attempt and order.
-- The webhook carries a reference, while tenant identity comes from storage.
CREATE FUNCTION public.get_bank_card_offer_webhook_transaction(p_reference text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'merchant_id', s.merchant_id, 'order_id', s.order_id,
    'gateway', t.gateway, 'gateway_reference', t.gateway_reference,
    'amount', t.amount, 'platform_fee', t.platform_fee
  )
  FROM public.transactions t
  JOIN private.bank_card_offer_payment_attempts a ON a.transaction_id = t.id
  JOIN private.bank_card_offer_order_snapshots s ON s.order_id = a.order_id
  JOIN public.orders o ON o.id = s.order_id AND o.merchant_id = s.merchant_id
  WHERE t.gateway_reference = p_reference AND t.gateway = 'paystack'
    AND t.transaction_type = 'payment' AND t.currency = 'NGN'
    AND t.merchant_id = s.merchant_id AND t.order_id = s.order_id
    AND t.amount * 100 = s.payable_kobo
    AND o.payment_method = 'bank_card_offer';
$$;
REVOKE ALL ON FUNCTION public.get_bank_card_offer_webhook_transaction(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bank_card_offer_webhook_transaction(text) TO service_role;
