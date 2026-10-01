-- Mark legacy Paystack DVA payment attempts so the abandoned-attempt sweep
-- treats Paystack's expected 404 for their placeholder references as
-- terminal. Correlate by the checkout session that created the attempt:
-- the session carries this attempt's reference AND a virtual account
-- number, which card sessions never set — durable DVA-specific
-- evidence. A shared order/time window is NOT sufficient: a card
-- attempt created while the order's DVA account is live would also be
-- stamped, and a transient provider 404 would then retire it instead
-- of holding it for re-verification (card references are
-- provider-real, so the sweep must keep rotating them). Attempts
-- without a DVA session stay unmarked and fail closed on 404 with a
-- durable review plus rotation. Rows already carrying a payment-type
-- marker are untouched, and the update is idempotent so a re-run
-- matches nothing.
UPDATE public.transactions t
SET metadata = coalesce(t.metadata, '{}'::jsonb) || '{"paystack_payment_type": "dva"}'::jsonb,
    updated_at = now()
WHERE t.transaction_type = 'payment'
  AND t.gateway = 'paystack'
  AND t.status IN ('pending', 'processing')
  AND coalesce(t.metadata->>'paystack_payment_type', '') = ''
  AND EXISTS (
    SELECT 1 FROM public.checkout_sessions s
    WHERE s.order_id = t.order_id
      AND s.merchant_id = t.merchant_id
      AND s.payment_reference = t.gateway_reference
      AND s.virtual_account_number IS NOT NULL
  );
