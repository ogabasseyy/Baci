-- Aggregate-claim coverage helper: the claim's completion gate
-- (external legs covered, internal legs covered, no unverified
-- manual Paystack claims) as a reviewable unit, split from the
-- claim implementation so each migration stays under the 300-line
-- limit. Called only from
-- public.claim_order_cancellation_side_effect, which runs SECURITY
-- DEFINER; this stays SECURITY INVOKER.
DROP FUNCTION IF EXISTS private.cancellation_refund_legs_covered_v1(uuid,uuid,text);
CREATE OR REPLACE FUNCTION private.cancellation_refund_legs_covered_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_sole_external_leg boolean;
  v_sole_leg_gateway text;
BEGIN
  -- Sole-leg attribution mirrors the manager verbatim: an unlinked
  -- refund attributes only to the single completed external leg.
  SELECT count(*)=1,
    max(public.normalized_gateway_name_v1(sole.gateway))
    INTO v_sole_external_leg,v_sole_leg_gateway FROM public.transactions sole
   WHERE sole.order_id=p_order_id AND sole.merchant_id=p_merchant_id
     AND sole.transaction_type='payment' AND sole.status='completed' AND sole.amount>0
     AND COALESCE(public.normalized_gateway_name_v1(sole.gateway),'') NOT IN (
       'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  RETURN NOT EXISTS (
    SELECT 1
      FROM public.transactions payment
     WHERE payment.order_id = p_order_id
       AND payment.merchant_id = p_merchant_id
       AND payment.transaction_type = 'payment'
       -- Mirror the completion gate's funded-leg statuses: refund-state
       -- legs (e.g. PayPal flips the payment row itself to refund_pending
       -- while its provider refund is pending) have no separate refund
       -- row yet, so scanning only completed legs would complete the
       -- side effect while the order stays paid with no worker resuming
       -- the outstanding refund.
       AND payment.status IN ('completed', 'refund_pending')
       AND payment.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(payment.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.transactions refund
          WHERE refund.order_id = p_order_id
            AND refund.merchant_id = p_merchant_id
            AND refund.transaction_type = 'refund'
            -- Normalize gateways exactly like the executor's linked path
            -- (whitespace-trimmed, uppercased; missing gateways never
            -- match): exact equality would leave a legacy `Paystack` leg
            -- uncovered here while the executor treats its `paystack`
            -- refund as covering it, stranding the order paid with no
            -- aggregate finalization.
            -- Terminal refund evidence is completed or refunded (legacy
            -- provider-confirmed rows): both count as returned money,
            -- mirroring the manager and the status trigger.
            AND refund.status IN ('completed', 'refunded')
            AND refund.amount > 0
            AND upper(btrim(refund.currency)) = upper(btrim(payment.currency))
            -- A locally completed Paystack refund counts only after it is
            -- provider-verified; other gateways keep local-status trust.
            -- Normalized like the gateway match above so a legacy
            -- `Paystack` row cannot slip through unverified while the
            -- executor (which normalizes) waits for verification. The
            -- normalizer maps missing gateways to NULL, keeping them
            -- strict, as before.
            AND (
              (
                public.normalized_gateway_name_v1(refund.gateway) = public.normalized_gateway_name_v1(payment.gateway)
                AND (
                  public.normalized_gateway_name_v1(refund.gateway) <> 'PAYSTACK'
                  OR refund.metadata->>'provider_refund_status' = 'processed'
                )
            AND (
              refund.metadata->>'payment_transaction_id' = payment.id::text
              OR (
                refund.metadata->>'payment_transaction_id' IS NULL
                -- As in the completion gate: the unlinked refund
                -- attributes to the sole completed leg only, never to a
                -- refund_pending leg whose own provider refund is still
                -- outstanding.
                AND payment.status = 'completed'
                AND 1 = (
                  SELECT count(*) FROM public.transactions only_payment
                   WHERE only_payment.order_id = p_order_id
                     AND only_payment.merchant_id = p_merchant_id
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
              -- Merchant-attested manual rows link explicitly and count as
              -- coverage in matching money, mirroring the executor
              -- matcher; they never sole-attribute, so an unlinked manual
              -- row stays out of coverage for review. A manual row
              -- positively declared as Paystack is only a merchant claim
              -- about provider money: it must carry provider confirmation
              -- before it can satisfy this completion gate, or a
              -- mistyped direct refund would reverse settlement and
              -- notify without matching any processed Paystack refund.
              -- No reconciler stamps manual rows today, so such rows
              -- defer to the executor's provider check and quarantine.
              OR (
                public.normalized_gateway_name_v1(refund.gateway) = 'MANUAL'
                AND refund.metadata->>'payment_transaction_id' = payment.id::text
                AND (
                  refund.metadata->>'method' IS DISTINCT FROM 'paystack'
                  OR refund.metadata->>'provider_refund_status' = 'processed'
                )
              )
            )
            )
          -- Partial refunds accumulate: the leg is covered when matching
          -- rows sum to at least its amount, mirroring the executor rule.
          HAVING coalesce(sum(refund.amount), 0) >= payment.amount
       )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.transactions internal_leg
     WHERE internal_leg.order_id = p_order_id
       AND internal_leg.merchant_id = p_merchant_id
       AND internal_leg.transaction_type = 'payment'
       AND internal_leg.status IN ('completed', 'refund_pending')
       AND internal_leg.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(internal_leg.gateway), '') IN (
         'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
       AND (
         SELECT COALESCE(SUM(refund.amount), 0)
           FROM public.transactions refund
          WHERE refund.order_id = p_order_id
            AND refund.merchant_id = p_merchant_id
            AND refund.transaction_type = 'refund'
            AND refund.status IN ('completed', 'refunded')
            AND refund.amount > 0
            AND UPPER(BTRIM(refund.currency)) = UPPER(BTRIM(internal_leg.currency))
            AND public.normalized_gateway_name_v1(refund.gateway) = 'MANUAL'
            AND refund.metadata->>'payment_transaction_id' = internal_leg.id::text
            -- Same positive Paystack gate as the external-leg branch:
            -- a manual row declared as Paystack is a merchant claim
            -- about provider money, never internal-leg coverage
            -- without provider confirmation.
            AND (
              refund.metadata->>'method' IS DISTINCT FROM 'paystack'
              OR refund.metadata->>'provider_refund_status' = 'processed'
            )
       ) < internal_leg.amount
  ) AND NOT EXISTS (
    SELECT 1 FROM public.transactions merchant_claim
     WHERE merchant_claim.order_id = p_order_id
       AND merchant_claim.merchant_id = p_merchant_id
       AND merchant_claim.transaction_type = 'refund'
       AND merchant_claim.status IN ('completed', 'refunded')
       AND merchant_claim.amount > 0
       AND UPPER(BTRIM(merchant_claim.currency))
         = UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN')))
       AND public.normalized_gateway_name_v1(merchant_claim.gateway) = 'MANUAL'
       AND merchant_claim.metadata->>'method' = 'paystack'
       AND merchant_claim.metadata->>'provider_refund_status'
         IS DISTINCT FROM 'processed'
       AND (merchant_claim.metadata->>'payment_transaction_id' IS NULL
         OR EXISTS (SELECT 1 FROM public.transactions leg
           WHERE leg.id::text
             = merchant_claim.metadata->>'payment_transaction_id'
             AND leg.order_id = p_order_id
             AND leg.merchant_id = p_merchant_id
             AND leg.transaction_type = 'payment'))
  ) AND NOT EXISTS (
    -- Anomalous terminal evidence blocks finalization exactly like
    -- the manager's pending gate: a currency-mismatched,
    -- link/gateway-mismatched, or invalid-link row keeps the
    -- manager reporting pending with recording disabled, so
    -- finalizing here would complete the side effect while the
    -- dashboard stays stuck on Processing and no drain revisits
    -- the row. Mirrors the manager's terminal anomaly branches
    -- verbatim over the same unfiltered universe: matching
    -- merchant-attested manuals pass; anything else blocks.
    SELECT 1 FROM public.transactions anomaly
     WHERE anomaly.order_id = p_order_id
       AND anomaly.merchant_id = p_merchant_id
       AND anomaly.transaction_type = 'refund'
       AND anomaly.status IN ('completed', 'refunded')
       AND anomaly.amount > 0
       AND (
         UPPER(BTRIM(anomaly.currency))
           IS DISTINCT FROM UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN')))
         OR NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
             WHERE leg.id::text = anomaly.metadata->>'payment_transaction_id'
               AND leg.order_id = p_order_id
               AND leg.merchant_id = p_merchant_id
               AND leg.transaction_type = 'payment'
               AND (public.normalized_gateway_name_v1(anomaly.gateway) = 'MANUAL'
                 OR public.normalized_gateway_name_v1(anomaly.gateway)
                   = public.normalized_gateway_name_v1(leg.gateway)))
           OR (anomaly.metadata->>'payment_transaction_id' IS NULL
             AND v_sole_external_leg
             AND public.normalized_gateway_name_v1(anomaly.gateway) = v_sole_leg_gateway)), false)
       )
  );
END; $$;
REVOKE ALL ON FUNCTION private.cancellation_refund_legs_covered_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
-- Mirrors the record helper: service_role fires the claim, and
-- authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.cancellation_refund_legs_covered_v1(uuid,uuid,text)
  TO service_role, authenticated;
