-- Companion to docs/runbooks/piggyvest-stuck-legacy-funds.md.
-- Do NOT run this file as a whole. Copy one block at a time, in the order the runbook gives,
-- into the production Supabase SQL editor. Fill in every value marked PASTE: a block whose
-- PASTE values are left in place fails before it reads or changes anything.
-- Drift safety: V3 runs as one transaction and fails closed. If the refund function's
-- signature, result or behaviour ever changes, the call errors or V3's exact result checks
-- raise STOP, and everything rolls back. The dry run always comes first, against the live schema.
-- Ledger rule: every money column in the read-only blocks counts completed rows only. V3 is
-- stricter: it stops on a debit that is not completed and on any return row, whatever its status.

-- [O1] READ-ONLY: Ogabassey orders holding wallet money that are neither paid nor cancelled
WITH m AS (SELECT id FROM public.merchants WHERE slug = 'ogabassey'),
held AS (
  SELECT t.source_id AS order_id,
         sum(CASE WHEN t.source_type = 'order_redemption' AND t.type = 'redemption'
                   AND t.status = 'completed' THEN t.amount ELSE 0 END)
       - sum(CASE WHEN t.source_type = 'order_reversal' AND t.status = 'completed'
                  THEN t.amount ELSE 0 END) AS wallet_held
    FROM public.customer_wallet_transactions t
    JOIN m ON m.id = t.merchant_id
   WHERE t.source_type IN ('order_redemption', 'order_reversal')
   GROUP BY t.source_id),
open_intents AS (
  SELECT i.order_id, count(*) AS n FROM public.order_wallet_funding_intents i
   WHERE i.status NOT IN ('completed', 'cancelled', 'expired', 'failed')
   GROUP BY i.order_id)
SELECT o.id AS order_id, o.order_number, o.payment_status, o.shipping_status, o.total,
       coalesce(h.wallet_held, 0) AS wallet_held, coalesce(oi.n, 0) AS open_funding_intents,
       (SELECT count(*) FROM public.transactions p
         WHERE p.order_id = o.id AND p.merchant_id = o.merchant_id
           AND p.transaction_type = 'payment'
           AND p.status IN ('pending', 'processing')) AS payments_in_flight,
       (SELECT count(*) FROM public.transactions p
         WHERE p.order_id = o.id AND p.merchant_id = o.merchant_id
           AND p.transaction_type = 'payment' AND p.amount > 0
           AND p.status IN ('completed', 'refund_pending', 'refunded')) AS completed_payments,
       o.created_at::date AS created_on
  FROM public.orders o
  JOIN m ON m.id = o.merchant_id
  LEFT JOIN held h ON h.order_id = o.id
  LEFT JOIN open_intents oi ON oi.order_id = o.id
 WHERE o.payment_status <> 'paid'
   AND o.cancelled_at IS NULL
   AND o.shipping_status NOT IN ('cancelled', 'canceled')
   AND (coalesce(h.wallet_held, 0) > 0 OR coalesce(oi.n, 0) > 0)
 ORDER BY o.created_at;

-- [O2] READ-ONLY: confirm the cancelled order gave its wallet money back
SELECT o.shipping_status, o.cancelled_by, o.cancelled_at IS NOT NULL AS has_cancelled_at,
       (SELECT coalesce(sum(t.amount), 0) FROM public.customer_wallet_transactions t
         WHERE t.source_id = o.id AND t.source_type = 'order_redemption'
           AND t.type = 'redemption' AND t.status = 'completed') AS taken,
       (SELECT coalesce(sum(t.amount), 0) FROM public.customer_wallet_transactions t
         WHERE t.source_id = o.id AND t.source_type = 'order_reversal'
           AND t.status = 'completed') AS returned,
       (SELECT count(*) FROM public.order_wallet_funding_intents i
         WHERE i.order_id = o.id
           AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed')) AS open_intents,
       (SELECT count(*) FROM public.order_cancellation_side_effects s
         WHERE s.order_id = o.id AND s.step = 'refund') AS card_refund_queued,
       (SELECT array_agg(DISTINCT n.balance_after) FROM public.customer_wallet_transactions n
         WHERE n.wallet_id = w.id
           AND n.created_at = (SELECT max(m.created_at) FROM public.customer_wallet_transactions m
                                WHERE m.wallet_id = w.id)) = ARRAY[w.available_balance]
       AND w.available_balance IS NOT NULL AS balance_matches_ledger
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id AND m.slug = 'ogabassey'
  LEFT JOIN public.customer_wallets w
    ON w.customer_id = o.customer_id AND w.merchant_id = o.merchant_id
 WHERE o.id = 'PASTE-ORDER-ID';

-- [V1] READ-ONLY: Ogabassey airtime, data and bill purchases without a final result
SELECT v.id AS vtu_id, v.status, v.source, v.type, v.amount,
       coalesce(v.metadata->>'provider', 'kuda') AS vendor,
       v.metadata->>'providerFallback' AS provider_fallback,
       v.metadata->'paymentSplit'->>'wallet' AS split_wallet,
       v.metadata->'paymentSplit'->>'card' AS split_card,
       l.debited, l.reversed, l.refunded, v.created_at::date AS created_on
  FROM public.vtu_transactions v
  JOIN public.merchants m ON m.id = v.merchant_id AND m.slug = 'ogabassey'
 CROSS JOIN LATERAL (
   SELECT coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_wallet_payment'
                                           AND t.type = 'redemption'
                                           AND t.status = 'completed'), 0) AS debited,
          coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_wallet_reversal'
                                           AND t.status = 'completed'), 0) AS reversed,
          coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_transaction_refund'
                                           AND t.status = 'completed'), 0) AS refunded
     FROM public.customer_wallet_transactions t
    WHERE t.source_id = v.id) l
 WHERE v.status IN ('pending', 'processing')
 ORDER BY v.created_at;

-- [V2] READ-ONLY: the references the vendor needs (ops log only, never GitHub)
SELECT coalesce(v.metadata->>'provider', 'kuda') AS vendor, v.request_reference,
       v.transaction_id AS vendor_transaction_id,
       v.metadata->>'monnifyVendReference' AS monnify_vend_reference, v.created_at
  FROM public.vtu_transactions v
  JOIN public.merchants m ON m.id = v.merchant_id AND m.slug = 'ogabassey'
 WHERE v.id = 'PASTE-VTU-ID';

-- [V3] WRITE, owner-approved: record the vendor's final answer for the stuck purchase.
-- Run first with v_apply := false (a dry run always ends in an error starting DRY RUN OK and
-- changes nothing), then with the owner's go-ahead once more with v_apply := true.
DO $$
DECLARE
  v_vtu_id   uuid    := 'PASTE-VTU-ID';
  v_outcome  text    := 'PASTE-OUTCOME';     -- 'failed' or 'delivered', as the vendor confirmed
  v_amount   numeric := 103.00;              -- the approved amount
  v_evidence text    := 'PASTE-OPS-LOG-REF'; -- ops log entry holding the vendor's answer
  v_apply    boolean := false;               -- false = dry run
  v_row record; v_rev record;
  v_debit numeric; v_debits int; v_foreign int; v_open int; v_back int; v_before numeric;
BEGIN
  -- A NULL typed in place of a value must never pass a check, so each input is tested for NULL.
  IF v_outcome IS NULL OR v_outcome NOT IN ('failed', 'delivered') THEN
    RAISE EXCEPTION 'STOP: v_outcome must be failed or delivered';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'STOP: v_amount must be the approved positive amount';
  END IF;
  IF coalesce(btrim(v_evidence), '') = '' OR v_evidence LIKE 'PASTE%' THEN
    RAISE EXCEPTION 'STOP: fill in v_evidence';
  END IF;
  -- Same lock order as reverse_vtu_wallet_payment: purchase lock, purchase row, wallet row.
  PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_vtu_id::text), 1, 16))::bit(64)::bigint);
  SELECT v.id, v.merchant_id, v.customer_id, v.status, v.source, v.type, v.amount, v.metadata
    INTO v_row
    FROM public.vtu_transactions v
    JOIN public.merchants m ON m.id = v.merchant_id AND m.slug = 'ogabassey'
   WHERE v.id = v_vtu_id
     FOR UPDATE OF v;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOP: no Ogabassey purchase with that id'; END IF;
  IF v_row.status <> 'processing' THEN
    RAISE EXCEPTION 'STOP: purchase is %, not processing', v_row.status;
  END IF;
  IF v_row.source <> 'checkout' OR v_row.type <> 'airtime' OR v_row.customer_id IS NULL
     OR v_row.amount <> v_amount THEN
    RAISE EXCEPTION 'STOP: purchase does not match the approved airtime purchase';
  END IF;
  -- Shape first, numbers second, as two separate checks so the cast below only ever reads JSON
  -- numbers. Like the app, a split counts only when its card and wallet are both numbers.
  IF jsonb_typeof(v_row.metadata->'paymentSplit') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_row.metadata->'paymentSplit'->'card') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_row.metadata->'paymentSplit'->'wallet') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'STOP: not a wallet-only purchase; escalate';
  END IF;
  IF (v_row.metadata->'paymentSplit'->>'card')::numeric <> 0
     OR (v_row.metadata->'paymentSplit'->>'wallet')::numeric <> v_amount THEN
    RAISE EXCEPTION 'STOP: not a wallet-only purchase; escalate';
  END IF;
  SELECT coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_wallet_payment'
                                          AND t.type = 'redemption'), 0),
         count(*) FILTER (WHERE t.source_type = 'vtu_wallet_payment' AND t.type = 'redemption'),
         count(*) FILTER (WHERE t.source_type = 'vtu_wallet_payment'
                            AND (t.customer_id <> v_row.customer_id
                                 OR t.merchant_id <> v_row.merchant_id)),
         count(*) FILTER (WHERE t.source_type = 'vtu_wallet_payment'
                            AND t.status IS DISTINCT FROM 'completed'),
         count(*) FILTER (WHERE t.source_type IN ('vtu_wallet_reversal', 'vtu_transaction_refund'))
    INTO v_debit, v_debits, v_foreign, v_open, v_back
    FROM public.customer_wallet_transactions t
   WHERE t.source_id = v_row.id;
  IF v_back > 0 THEN RAISE EXCEPTION 'STOP: money was already returned for this purchase'; END IF;
  -- The ledger status is nullable and the refund function credits any debit row, so a debit
  -- that is pending, failed, expired or has no status must stop here, never count as paid.
  IF v_open > 0 THEN
    RAISE EXCEPTION 'STOP: a wallet debit for this purchase is not completed; escalate';
  END IF;
  IF v_outcome = 'delivered' AND (v_debits <> 1 OR v_debit <> v_amount) THEN
    RAISE EXCEPTION 'STOP: the wallet has not paid for this purchase; escalate';
  END IF;
  IF v_debits > 1 OR v_foreign > 0 OR v_debit NOT IN (0, v_amount)
     OR (v_debit = 0 AND v_row.metadata->>'walletDebited' = 'true') THEN
    RAISE EXCEPTION 'STOP: the wallet ledger does not match the purchase; escalate';
  END IF;
  -- The app corrects a re-routed purchase's cashback and commission before it records
  -- success. This block cannot, so a delivered answer on one is escalated instead.
  IF v_outcome = 'delivered' AND v_row.metadata->>'providerFallback' IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: purchase was re-routed (provider fallback); escalate';
  END IF;

  -- clock_timestamp(), not now(): now() is when this block was sent, before any lock wait.
  UPDATE public.vtu_transactions
     SET status = CASE v_outcome WHEN 'failed' THEN 'failed' ELSE 'successful' END,
         error_message = CASE v_outcome WHEN 'failed'
                           THEN 'Vendor confirmed the purchase failed (manual requery)' END,
         metadata = metadata || jsonb_build_object('opsResolution', jsonb_build_object(
           'outcome', 'vendor_confirmed_' || v_outcome, 'evidenceRef', v_evidence,
           'recordedAt', clock_timestamp(), 'runbook', 'piggyvest-stuck-legacy-funds'))
   WHERE id = v_row.id AND status = 'processing';
  IF v_outcome = 'delivered' THEN
    UPDATE public.vtu_transactions SET metadata = metadata || '{"walletDebited": true}'::jsonb
     WHERE id = v_row.id;
  ELSIF v_debit = 0 THEN
    -- Nothing was taken from the wallet, so there is nothing to give back.
    UPDATE public.vtu_transactions
       SET metadata = metadata || '{"refundSkipped": "no_charge"}'::jsonb
     WHERE id = v_row.id;
  ELSE
    SELECT w.available_balance INTO v_before FROM public.customer_wallets w
     WHERE w.customer_id = v_row.customer_id AND w.merchant_id = v_row.merchant_id
       FOR UPDATE;
    SELECT r.success, r.reversed_amount, r.new_balance INTO v_rev
      FROM public.reverse_vtu_wallet_payment(
        v_row.id, 'VTU vend failed (vendor confirmed)', v_row.merchant_id, 'failed') r;
    IF v_rev.success IS NOT TRUE OR v_rev.reversed_amount IS DISTINCT FROM v_amount
       OR v_rev.new_balance IS DISTINCT FROM v_before + v_amount THEN
      RAISE EXCEPTION 'STOP: the reversal did not return exactly %', v_amount;
    END IF;
    -- The same refund markers the app writes after a vendor failure. Like the app, issuing
    -- the refund drops any skip marker left by an earlier pass.
    UPDATE public.vtu_transactions
       SET metadata = (metadata - 'refundSkipped') || jsonb_build_object(
             'walletDebited', true, 'refundIssued', true, 'refundAmount', 0,
             'refundContext', 'hybrid_vend_failure',
             'refundedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     WHERE id = v_row.id;
  END IF;
  IF v_apply IS NOT TRUE THEN
    RAISE EXCEPTION 'DRY RUN OK: would record % and return % (nothing changed)',
      v_outcome, CASE v_outcome WHEN 'failed' THEN v_debit ELSE 0 END;
  END IF;
  RAISE NOTICE 'APPLIED: recorded %', v_outcome;
END $$;

-- [V4] READ-ONLY: confirm the purchase is closed and the wallet matches its ledger.
-- credits_pending: a successful purchase whose commission, cashback or loyalty points the
-- checker has not credited yet.
SELECT v.status, v.metadata->'opsResolution'->>'outcome' AS outcome,
       l.debited, l.returned, l.refunded,
       (SELECT array_agg(DISTINCT n.balance_after) FROM public.customer_wallet_transactions n
         WHERE n.wallet_id = w.id
           AND n.created_at = (SELECT max(m.created_at) FROM public.customer_wallet_transactions m
                                WHERE m.wallet_id = w.id)) = ARRAY[w.available_balance]
       AND w.available_balance IS NOT NULL AS balance_matches_ledger,
       v.status = 'successful'
         AND ((coalesce(v.merchant_commission, 0) > 0
               AND v.metadata->>'merchantWalletCredited' IS DISTINCT FROM 'true')
           OR (coalesce(v.customer_cashback, 0) > 0
               AND v.metadata->>'customerWalletCredited' IS DISTINCT FROM 'true')
           OR (v.type = 'airtime' AND coalesce(v.customer_cashback, 0) >= 3
               AND v.metadata->>'loyaltyPointsAwarded' IS DISTINCT FROM 'true')) AS credits_pending
  FROM public.vtu_transactions v
  JOIN public.merchants m ON m.id = v.merchant_id AND m.slug = 'ogabassey'
  LEFT JOIN public.customer_wallets w
    ON w.customer_id = v.customer_id AND w.merchant_id = v.merchant_id
 CROSS JOIN LATERAL (
   SELECT coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_wallet_payment'
                                           AND t.type = 'redemption'
                                           AND t.status = 'completed'), 0) AS debited,
          coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_wallet_reversal'
                                           AND t.status = 'completed'), 0) AS returned,
          coalesce(sum(t.amount) FILTER (WHERE t.source_type = 'vtu_transaction_refund'
                                           AND t.status = 'completed'), 0) AS refunded
     FROM public.customer_wallet_transactions t
    WHERE t.source_id = v.id) l
 WHERE v.id = 'PASTE-VTU-ID';
