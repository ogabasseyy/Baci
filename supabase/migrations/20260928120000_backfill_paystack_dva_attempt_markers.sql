-- Mark legacy Paystack DVA payment attempts so the abandoned-attempt sweep
-- treats Paystack's expected 404 for their placeholder references as
-- terminal. Only assignment-correlated rows qualify: the initialize route
-- persists the DVA assignment and inserts the attempt in the same request,
-- so a DVA attempt lands within minutes after its account row. A bare
-- same-order match would also stamp a later card attempt for the order,
-- and the sweep would then retire it on a 404 that is nonterminal for
-- ordinary captures. Rows already carrying a payment-type marker are
-- untouched, and the update is idempotent so a re-run matches nothing.
UPDATE public.transactions t
SET metadata = coalesce(t.metadata, '{}'::jsonb) || '{"paystack_payment_type": "dva"}'::jsonb,
    updated_at = now()
WHERE t.transaction_type = 'payment'
  AND t.gateway = 'paystack'
  AND t.status IN ('pending', 'processing')
  AND coalesce(t.metadata->>'paystack_payment_type', '') = ''
  AND EXISTS (
    SELECT 1 FROM public.order_payment_accounts a
    WHERE a.order_id = t.order_id
      AND a.provider = 'paystack'
      AND t.created_at >= a.created_at
      AND t.created_at < a.created_at + interval '5 minutes'
  );
