-- Requeue cancellation refund side effects the previous claim predicate
-- falsely completed: partial coverage or unverified Paystack rows used to
-- satisfy the completion check, stranding the remaining balance with no
-- worker to initiate it (completed rows are never reselected, and the
-- claim's conflict update accepts only failed rows). Flip those rows back
-- to failed with a fresh attempt budget so the drain resumes them; the
-- reset matters because a falsely completed row may already sit at the
-- five-attempt cap from its pre-completion failures. Legitimately
-- completed rows (every external leg covered in matching,
-- provider-verified money, mirroring the claim predicate) are untouched.
-- Idempotent: a re-run matches nothing (requeued rows are failed,
-- covered rows stay completed).
UPDATE public.order_cancellation_side_effects AS side_effect
   SET status = 'failed',
       attempts = 0,
       completed_at = NULL,
       error = 'Requeued: payment legs lack aggregate provider-verified refund coverage'
 WHERE side_effect.step = 'refund'
   AND side_effect.status = 'completed'
   AND EXISTS (
     SELECT 1
       FROM public.transactions payment
      WHERE payment.order_id = side_effect.order_id
        AND payment.merchant_id = side_effect.merchant_id
        AND payment.transaction_type = 'payment'
        -- Mirror the completion gate's funded-leg statuses (see the claim
        -- predicate): refund-state legs without a separate refund row
        -- must also requeue their falsely completed side effect.
        AND payment.status IN ('completed', 'refund_pending')
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
             AND (
               refund.metadata->>'payment_transaction_id' = payment.id::text
               OR (
                 refund.metadata->>'payment_transaction_id' IS NULL
                 AND 1 = (
                   SELECT count(*) FROM public.transactions only_payment
                    WHERE only_payment.order_id = side_effect.order_id
                      AND only_payment.merchant_id = side_effect.merchant_id
                      AND only_payment.transaction_type = 'payment'
                      AND only_payment.status = 'completed'
                      AND only_payment.amount > 0
                      AND COALESCE(public.normalized_gateway_name_v1(only_payment.gateway), '') NOT IN (
                        'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
                        'PAY_ON_DELIVERY'
                      )
                 )
               )
             )
           HAVING coalesce(sum(refund.amount), 0) >= payment.amount
        )
   );
