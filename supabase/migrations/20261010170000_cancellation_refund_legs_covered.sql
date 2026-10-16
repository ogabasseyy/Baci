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
                -- Manuals never cover a leg whose provider refund is
                -- still in flight (this branch is external-only):
                -- finalizing on merchant money alone would
                -- double-pay when the provider refund settles.
                AND payment.status = 'completed'
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
       -- A refunded internal leg still needs its linked manual: no
       -- provider flips cash-like rows (unlike external
       -- self-terminal legs), so the status alone is untrusted
       -- drift, and the manager likewise reports its balance
       -- outstanding. Trusting it here would finalize an order
       -- the dashboard still shows as owed.
       AND internal_leg.status IN ('completed', 'refund_pending', 'refunded')
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
    -- Unverified Paystack evidence blocks finalization whether it is
    -- a merchant declaration or an ordinary provider row: either way
    -- the money is not confirmed home, mirroring the pending
    -- helper's normalized Paystack predicate. Without the ordinary
    -- arm, an extra linked same-currency terminal Paystack row with
    -- no processed stamp would finalize beside full verified
    -- coverage and settle unnoticed.
    SELECT 1 FROM public.transactions merchant_claim
     WHERE merchant_claim.order_id = p_order_id
       AND merchant_claim.merchant_id = p_merchant_id
       AND merchant_claim.transaction_type = 'refund'
       AND merchant_claim.status IN ('completed', 'refunded')
       -- No amount filter (like the anomaly veto below): the pending
       -- gate floors nonpositive unverified rows to one unit, so
       -- excluding them here would finalize while the manager still
       -- reports processing.
       AND UPPER(BTRIM(merchant_claim.currency))
         = UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN')))
       AND (public.normalized_gateway_name_v1(merchant_claim.gateway) = 'PAYSTACK'
         OR (public.normalized_gateway_name_v1(merchant_claim.gateway) = 'MANUAL'
           AND merchant_claim.metadata->>'method' = 'paystack'))
       AND merchant_claim.metadata->>'provider_refund_status'
         IS DISTINCT FROM 'processed'
       AND (merchant_claim.metadata->>'payment_transaction_id' IS NULL
         OR EXISTS (SELECT 1 FROM public.transactions leg
           WHERE leg.id::text
             = merchant_claim.metadata->>'payment_transaction_id'
             AND leg.order_id = p_order_id
             AND leg.merchant_id = p_merchant_id
             AND leg.transaction_type = 'payment'
             AND leg.status IN ('completed', 'refund_pending', 'refunded')))
  ) AND NOT EXISTS (
    -- In-flight refund evidence blocks finalization even when every
    -- leg is terminally covered: finalizing would complete the side
    -- effect (never drained again) while the manager still reports
    -- pending and a second provider refund could settle unnoticed.
    -- Mirrors the pending gate's nonterminal predicate verbatim;
    -- only definitively failed rows are dead enough to ignore.
    SELECT 1 FROM public.transactions in_flight
     WHERE in_flight.order_id = p_order_id
       AND in_flight.merchant_id = p_merchant_id
       AND in_flight.transaction_type = 'refund'
       AND in_flight.status NOT IN ('completed', 'refunded', 'failed')
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
       -- No amount filter: the pending gate floors nonpositive
       -- anomalous rows to one unit, so excluding them here would
       -- finalize while the manager still reports processing.
       AND (
         UPPER(BTRIM(anomaly.currency))
           IS DISTINCT FROM UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN')))
         OR NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
             WHERE leg.id::text = anomaly.metadata->>'payment_transaction_id'
               AND leg.order_id = p_order_id
               AND leg.merchant_id = p_merchant_id
               AND leg.transaction_type = 'payment'
               -- A link is valid only to a funded leg: the executor
               -- never loads failed legs, so a refund on one is
               -- unreconciled evidence, never coverage.
               AND leg.status IN ('completed', 'refund_pending', 'refunded')
               AND (public.normalized_gateway_name_v1(anomaly.gateway) = 'MANUAL'
                 OR public.normalized_gateway_name_v1(anomaly.gateway)
                   = public.normalized_gateway_name_v1(leg.gateway)))
           OR (anomaly.metadata->>'payment_transaction_id' IS NULL
             AND v_sole_external_leg
             AND public.normalized_gateway_name_v1(anomaly.gateway) = v_sole_leg_gateway)), false)
       )
  ) AND NOT EXISTS (
    -- Self-terminal refunded legs are invisible to the coverage scans
    -- above (completed/refund_pending only), so a blank or
    -- foreign-currency one would finalize without validation while
    -- the manager excludes its amount and the notification ledger
    -- rejects the mismatch — a finalized order with contradictory
    -- outstanding money and a dead-lettered notification. A refunded
    -- leg counts as returned only in the order currency.
    SELECT 1 FROM public.transactions self_terminal
     WHERE self_terminal.order_id = p_order_id
       AND self_terminal.merchant_id = p_merchant_id
       AND self_terminal.transaction_type = 'payment'
       AND self_terminal.status = 'refunded'
       AND self_terminal.amount > 0
       AND UPPER(BTRIM(self_terminal.currency))
         IS DISTINCT FROM UPPER(BTRIM(COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN')))
  );
END; $$;
REVOKE ALL ON FUNCTION private.cancellation_refund_legs_covered_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
-- Mirrors the record helper: service_role fires the claim, and
-- authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.cancellation_refund_legs_covered_v1(uuid,uuid,text)
  TO service_role, authenticated;
