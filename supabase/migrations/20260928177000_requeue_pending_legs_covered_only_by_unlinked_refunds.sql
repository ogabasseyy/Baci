-- Requeue completed refund side effects whose refund_pending legs are
-- covered only by the repair's unlinked-refund attribution. The
-- 20260928150000 repair widened the coverage loop to refund_pending legs
-- but kept the unlinked clause, which counts the order's sole completed
-- leg without requiring the CURRENT leg to be completed: on an order
-- with exactly one completed leg plus a refund_pending leg, one large
-- unlinked refund "covers" both, so the row stays completed. If the
-- pending provider leg later self-terminalizes, no drain remains to
-- finalize the order, reverse settlement, or enqueue notifications. The
-- claim predicate never lets this happen because its outer loop only
-- visits completed legs, so unlinked refunds there can only satisfy a
-- completed leg. Mirror that restriction: a refund_pending leg counts
-- as covered only by LINKED provider-verified refunds. Rows the repair
-- legitimately left completed (every pending leg link-covered) are
-- untouched. Idempotent: a re-run matches nothing (requeued rows are
-- failed, covered rows stay completed).
UPDATE public.order_cancellation_side_effects AS side_effect
   SET status = 'failed',
       attempts = 0,
       completed_at = NULL,
       error = 'Requeued: refund_pending legs lack linked provider-verified refund coverage'
 WHERE side_effect.step = 'refund'
   AND side_effect.status = 'completed'
   AND EXISTS (
     SELECT 1
       FROM public.transactions payment
      WHERE payment.order_id = side_effect.order_id
        AND payment.merchant_id = side_effect.merchant_id
        AND payment.transaction_type = 'payment'
        -- Only refund_pending legs: completed legs keep the repair's
        -- verdict, where unlinked attribution to the sole completed leg
        -- matches the claim rule.
        AND payment.status = 'refund_pending'
        AND payment.amount > 0
        AND COALESCE(public.normalized_gateway_name_v1(payment.gateway), '') NOT IN (
          'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.transactions refund
           WHERE refund.order_id = side_effect.order_id
             AND refund.merchant_id = side_effect.merchant_id
             AND refund.transaction_type = 'refund'
             -- Normalize gateways exactly like the aggregate coverage
             -- gate (whitespace-trimmed, uppercased; missing gateways
             -- never match).
             AND public.normalized_gateway_name_v1(refund.gateway) = public.normalized_gateway_name_v1(payment.gateway)
             AND refund.status = 'completed'
             AND refund.amount > 0
             AND upper(btrim(refund.currency)) = upper(btrim(payment.currency))
             AND (
               public.normalized_gateway_name_v1(refund.gateway) <> 'PAYSTACK'
               OR refund.metadata->>'provider_refund_status' = 'processed'
             )
             -- No unlinked fallback: unlike a completed leg, a pending leg
             -- can never inherit the order's sole-completed-leg refund.
             AND refund.metadata->>'payment_transaction_id' = payment.id::text
           HAVING coalesce(sum(refund.amount), 0) >= payment.amount
        )
   );
