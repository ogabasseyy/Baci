-- Merge later over-refund evidence into the open review instead of
-- discarding it. When an order already has an open over-refund review
-- and a later provider-verified refund adds another over-refunded leg
-- or increases the excess, the old discard-on-conflict behavior
-- left the existing review with stale candidates and amounts, so
-- operations could
-- resolve it without seeing the later excess. Same signature:
-- OR REPLACE keeps every existing call on the new body.

CREATE OR REPLACE FUNCTION public.merge_over_refund_review_legs_v1(
  p_existing jsonb,
  p_incoming jsonb
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Keyed union by payment leg: incoming legs replace same-leg stale
  -- entries (excess grew), new legs append, untouched legs persist.
  -- Deterministic order keeps successive merges idempotent.
  SELECT coalesce(
    jsonb_agg(keyed.elem ORDER BY keyed.elem->>'payment_transaction_id'),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT ON ((elem->>'payment_transaction_id')) elem
    FROM (
      SELECT jsonb_array_elements(coalesce(p_existing, '[]'::jsonb)) AS elem, 0 AS priority
      UNION ALL
      SELECT jsonb_array_elements(coalesce(p_incoming, '[]'::jsonb)) AS elem, 1 AS priority
    ) AS combined
    ORDER BY (elem->>'payment_transaction_id'), priority DESC
  ) AS keyed;
$$;

CREATE OR REPLACE FUNCTION public.flag_paystack_cancellation_over_refunds_v1(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_legs jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Funded external legs whose completed refunds exceed the leg amount.
  -- Mirrors the coverage check's leg/refund matching in
  -- record_verified_paystack_cancellation_refund_v1 so only genuine
  -- same-leg, same-currency, provider-verified excess flags.
  SELECT jsonb_agg(to_jsonb(excess)) INTO v_legs
  FROM (
    SELECT p.id AS payment_transaction_id,
           p.gateway_reference AS payment_reference,
           p.amount AS payment_amount,
           p.currency AS payment_currency,
           coalesce(sum(r.amount), 0) AS refunded_amount
      FROM public.transactions p
      LEFT JOIN public.transactions r
        ON r.order_id = p.order_id AND r.merchant_id = p.merchant_id
       AND r.transaction_type = 'refund'
       AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)
       AND r.status = 'completed'
       AND r.amount > 0
       AND upper(btrim(r.currency)) = upper(btrim(p.currency))
       AND (
         public.normalized_gateway_name_v1(r.gateway) <> 'PAYSTACK'
         OR r.metadata->>'provider_refund_status' = 'processed'
       )
       AND (
         r.metadata->>'payment_transaction_id' = p.id::text
         OR (
           r.metadata->>'payment_transaction_id' IS NULL
           AND p.status = 'completed'
           AND 1 = (
             SELECT count(*) FROM public.transactions only_payment
              WHERE only_payment.order_id = p.order_id
                AND only_payment.merchant_id = p.merchant_id
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
     WHERE p.order_id = p_order_id AND p.merchant_id = p_merchant_id
       AND p.transaction_type = 'payment'
       AND p.status IN ('completed', 'refund_pending')
       AND p.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(p.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
         'PAY_ON_DELIVERY'
       )
     GROUP BY p.id, p.gateway_reference, p.amount, p.currency
    HAVING coalesce(sum(r.amount), 0) > p.amount
  ) AS excess;
  IF v_legs IS NULL THEN RETURN; END IF;
  INSERT INTO public.reconciliation_review
    (issue_type, order_id, merchant_id, reason, candidates, metadata)
  VALUES (
    'order_cancellation_over_refund_requires_review',
    p_order_id,
    p_merchant_id,
    'One or more payment legs were refunded above their payment amount; verify the excess with the provider before closing',
    v_legs,
    jsonb_build_object('over_refunded_legs', v_legs)
  )
  -- An open over-refund review absorbs the newly computed evidence
  -- (same conflict target as every order-scoped review upsert):
  -- concurrent finalizations must neither duplicate it nor lose the
  -- later excess.
  ON CONFLICT (issue_type, order_id)
    WHERE resolved_at IS NULL AND order_id IS NOT NULL
  DO UPDATE SET
    candidates = public.merge_over_refund_review_legs_v1(
      reconciliation_review.candidates, EXCLUDED.candidates
    ),
    metadata = jsonb_build_object(
      'over_refunded_legs',
      public.merge_over_refund_review_legs_v1(
        reconciliation_review.candidates, EXCLUDED.candidates
      )
    ),
    updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.flag_paystack_cancellation_over_refunds_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_paystack_cancellation_over_refunds_v1(uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.merge_over_refund_review_legs_v1(jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_over_refund_review_legs_v1(jsonb,jsonb)
  TO service_role;
