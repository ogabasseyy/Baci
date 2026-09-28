-- Mark legacy Paystack DVA payment attempts so the abandoned-attempt sweep
-- treats Paystack's expected 404 for their placeholder references as
-- terminal. Correlate by the account's LIVE WINDOW, not its creation
-- time: the reservation RPC's `existing` path extends `expires_at` on a
-- retry without touching `created_at`/`assigned_at`
-- (20260827060000_repair_paystack_dva_reservation.sql), so a retry more
-- than five minutes after the original assignment creates a genuine DVA
-- attempt no creation-time window can see. Every successful DVA attempt
-- (original or retry) is created while its account is live — a retry
-- only succeeds through the `existing` path, which requires an
-- unexpired account — so the live window is exactly the region a legacy
-- DVA attempt can fall in. The window uses the same live-account
-- COALESCE the reservation RPC and the DVA matcher use.
-- Residual risk: a same-order card attempt created while the DVA account
-- is live is also stamped. The stamp only matters on a Paystack 404, and
-- card references are provider-real (Paystack created them at
-- initialize), so in practice the sweep never consults it for those
-- rows; a transient provider 404 during Paystack inconsistency would
-- retire instead of hold. Rows already carrying a payment-type marker are
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
      AND t.created_at < coalesce(
        a.expires_at,
        a.assigned_at + interval '90 minutes',
        a.created_at + interval '90 minutes'
      )
  );
