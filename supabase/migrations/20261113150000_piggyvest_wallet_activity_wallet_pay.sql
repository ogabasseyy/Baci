-- PiggyVest wallet activity: also list what the customer paid from the main
-- wallet (IMEI checks, airtime/data/bills) and the refunds of those
-- payments, so every spend and refund leaves a customer-readable record.
-- Replaces public.list_piggyvest_wallet_activity from
-- 20261113140000_piggyvest_wallet_activity_read with the same signature,
-- columns (fee_kobo included: zero for every row but a deposit), keyset
-- paging and grants, adding two branches:
--
--   wallet_spend    piggyvest_primary.wallet_payments         money out
--   wallet_refund   piggyvest_primary.wallet_payment_refunds  money in
--
-- A spend is listed once its PIN has reserved money (reserved, dispatched,
-- confirmed or under review); an issued, released or expired attempt never
-- moved money and is not activity. A refund is listed once it is sent
-- (dispatched, confirmed or under review), or proven successful late, and
-- only for a listed spend. The label names the purchase:
-- "IMEI check", or for airtime/data/bills the type, network or biller and
-- the phone or meter number masked to its first and last four characters,
-- read from the caller's own vtu_transactions row (same customer and store).
--
-- Every row keeps one fixed date, so keyset pages stay stable as rows
-- settle: spends when the PIN reserved the money, refunds when sent, and
-- goal returns when dispatched (no longer when settled). Goal titles are
-- read only from the caller's own goals in this store. A phone or meter
-- number of four characters or fewer is shown as a bare mask.
-- Labels are capped at 120 characters.
--
-- Never returned: provider ids, references, wallet ids, purchase ids, the
-- full phone or meter number. Read-only and STABLE. No table policy changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_piggyvest_wallet_activity(
  p_merchant_id uuid,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  kind text,
  direction text,
  amount_kobo bigint,
  fee_kobo bigint,
  label text,
  status text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;
  IF p_merchant_id IS NULL
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid activity request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT intent.id AS intent_id, intent.customer_id, intent.merchant_id
      FROM piggyvest_primary.onboarding_intents AS intent
      JOIN public.customers AS customer
        ON customer.id = intent.customer_id
       AND customer.merchant_id = intent.merchant_id
       AND customer.user_id = intent.user_id
     WHERE intent.user_id = v_user
       AND intent.merchant_id = p_merchant_id
       AND intent.state IN ('accepted', 'verified')
  ),
  -- What each wallet payment bought, in customer words (masked numbers).
  paid AS (
    SELECT payment.id, payment.intent_id, payment.amount_kobo, payment.state,
           -- Money that moved for the purchase: listed. A failed transfer
           -- that only charged a fee is not a purchase (the amount never
           -- moved, Codex P2); a released attempt proven successful while
           -- another was unresolved did move money (Codex P2).
           (payment.state IN ('reserved', 'dispatched', 'confirmed')
             OR (payment.state = 'needs_review'
                 AND payment.review_reason IS DISTINCT FROM 'failed_with_fee')
             OR (payment.state = 'released'
                 AND payment.review_reason = 'late_success_deferred')) AS listed,
           -- Set once when the PIN reserved it: a row never moves between
           -- keyset pages as the payment settles.
           COALESCE(payment.reserved_at, payment.issued_at) AS occurred_at,
           -- Never empty: a purchase row with no type or biller still reads
           -- as a purchase (Muse).
           COALESCE(NULLIF(CASE
             WHEN payment.purpose = 'imei_check' THEN 'IMEI check'
             WHEN purchase.id IS NULL THEN 'Airtime, data or bill'
             ELSE CASE purchase.type
                    WHEN 'airtime' THEN 'Airtime'
                    WHEN 'data' THEN 'Data'
                    -- The biller name is the only free text: capped before
                    -- the masked number is added, so a long name never cuts
                    -- the distinguishing suffix, even with the refund
                    -- prefix (Muse).
                    ELSE COALESCE(NULLIF(pg_catalog.left(pg_catalog.btrim(purchase.biller_name), 80), ''),
                                  pg_catalog.initcap(purchase.type))
                  END
                  || CASE WHEN purchase.type IN ('airtime', 'data')
                            AND NULLIF(pg_catalog.btrim(purchase.network_provider), '') IS NOT NULL
                          -- Capped like the biller name, so the masked
                          -- number always survives the label cap (Muse).
                          THEN ' · ' || pg_catalog.upper(pg_catalog.left(
                                 pg_catalog.btrim(purchase.network_provider), 20)) ELSE '' END
                  || COALESCE(' · ' || CASE
                       WHEN pg_catalog.char_length(target.number) > 8
                         THEN pg_catalog.left(target.number, 4) || '…' || pg_catalog.right(target.number, 4)
                       WHEN pg_catalog.char_length(target.number) > 4
                         THEN '…' || pg_catalog.right(target.number, 4)
                     -- Too short to show any of it.
                     WHEN pg_catalog.char_length(target.number) > 0 THEN '…'
                     END, '')
           END, ''), 'Airtime, data or bill') AS label
      FROM piggyvest_primary.wallet_payments AS payment
      JOIN mine ON mine.intent_id = payment.intent_id
      LEFT JOIN public.vtu_transactions AS purchase
        ON payment.purpose = 'vtu'
       AND purchase.id::text = payment.purchase_ref
       AND purchase.customer_id = mine.customer_id
       AND purchase.merchant_id = mine.merchant_id
      LEFT JOIN LATERAL (
        SELECT pg_catalog.regexp_replace(
                 COALESCE(NULLIF(purchase.customer_identifier, ''), purchase.phone_number, ''),
                 '[^A-Za-z0-9]', '', 'g') AS number
      ) AS target ON true
  ),
  movements AS (
    -- Deposits: bank transfers (and older card fundings) into the wallet.
    SELECT receipt.id,
           CASE WHEN receipt.financial_identity ->> 'custodyKind' = 'card'
                THEN 'card_funding' ELSE 'bank_transfer' END AS kind,
           'in'::text AS direction,
           -- The amount that reached the wallet: PiggyVest deducts the
           -- deposit fee from the transfer, so the balance moves by the
           -- net. Rows then add up to the balance (Fable walk F3).
           (receipt.financial_identity ->> 'amountKobo')::bigint
             - CASE WHEN receipt.financial_identity ->> 'feeKobo' ~ '^[0-9]{1,12}$'
                    THEN (receipt.financial_identity ->> 'feeKobo')::bigint ELSE 0 END
             AS amount_kobo,
           CASE WHEN receipt.financial_identity ->> 'feeKobo' ~ '^[0-9]{1,12}$'
                THEN (receipt.financial_identity ->> 'feeKobo')::bigint ELSE 0 END
             AS fee_kobo,
           CASE WHEN receipt.financial_identity ->> 'custodyKind' = 'card'
                THEN 'Card top-up' ELSE 'Money added' END AS label,
           'completed'::text AS status,
           receipt.created_at AS occurred_at
      FROM piggyvest_primary.inflow_receipts AS receipt
      JOIN mine ON mine.intent_id = receipt.intent_id
     WHERE receipt.financial_identity ->> 'amountKobo' ~ '^[1-9][0-9]{0,11}$'
       -- A fee that would leave nothing credited is not a deposit row.
       AND (receipt.financial_identity ->> 'amountKobo')::bigint
           > CASE WHEN receipt.financial_identity ->> 'feeKobo' ~ '^[0-9]{1,12}$'
                  THEN (receipt.financial_identity ->> 'feeKobo')::bigint ELSE 0 END
    UNION ALL
    -- Contributions: wallet to savings goal. A cancelled reservation never
    -- moved money, so it is not activity.
    SELECT operation.id,
           'savings_contribution',
           'out',
           operation.amount_kobo,
           0::bigint,
           'Saved to ' || COALESCE(goal.title, 'a savings goal'),
           CASE WHEN operation.state = 'confirmed' THEN 'completed' ELSE 'pending' END,
           operation.created_at
      FROM piggyvest_primary.savings_operations AS operation
      JOIN mine ON mine.intent_id = operation.intent_id
      LEFT JOIN public.customer_savings_goals AS goal
        ON goal.id = operation.goal_id
       AND goal.customer_id = mine.customer_id
       AND goal.merchant_id = mine.merchant_id
     WHERE operation.state IN ('reserved', 'dispatched', 'confirmed')
    UNION ALL
    -- Goal cancelled early: its balance returns to the wallet.
    SELECT cancel.id,
           'goal_refund',
           'in',
           cancel.amount_kobo,
           0::bigint,
           'Returned from ' || COALESCE(goal.title, 'a savings goal'),
           CASE WHEN cancel.state IN ('confirmed', 'reviewed') THEN 'completed' ELSE 'pending' END,
           COALESCE(cancel.dispatched_at, cancel.reserved_at, cancel.issued_at)
      FROM piggyvest_primary.goal_cancel_operations AS cancel
      JOIN mine ON mine.intent_id = cancel.intent_id
      LEFT JOIN public.customer_savings_goals AS goal
        ON goal.id = cancel.goal_id
       AND goal.customer_id = mine.customer_id
       AND goal.merchant_id = mine.merchant_id
     WHERE cancel.state IN ('dispatched', 'confirmed', 'needs_review', 'reviewed')
       AND cancel.amount_kobo IS NOT NULL
    UNION ALL
    -- Goal completed: its full balance, interest included, returns to the wallet.
    SELECT complete.id,
           'goal_completed',
           'in',
           complete.amount_kobo,
           0::bigint,
           'Goal completed: ' || COALESCE(goal.title, 'savings goal'),
           CASE WHEN complete.state IN ('confirmed', 'reviewed') THEN 'completed' ELSE 'pending' END,
           COALESCE(complete.dispatched_at, complete.reserved_at, complete.issued_at)
      FROM piggyvest_primary.goal_complete_operations AS complete
      JOIN mine ON mine.intent_id = complete.intent_id
      LEFT JOIN public.customer_savings_goals AS goal
        ON goal.id = complete.goal_id
       AND goal.customer_id = mine.customer_id
       AND goal.merchant_id = mine.merchant_id
     WHERE complete.state IN ('dispatched', 'confirmed', 'needs_review', 'reviewed')
       AND complete.amount_kobo IS NOT NULL
    UNION ALL
    -- Paid from the wallet: once the PIN reserved the money.
    SELECT paid.id,
           'wallet_spend',
           'out',
           paid.amount_kobo,
           0::bigint,
           paid.label,
           CASE WHEN paid.state = 'confirmed' THEN 'completed' ELSE 'pending' END,
           paid.occurred_at
      FROM paid
     WHERE paid.listed
    UNION ALL
    -- Refunded to the wallet: once the refund is sent.
    SELECT refund.id,
           'wallet_refund',
           'in',
           refund.amount_kobo,
           0::bigint,
           'Refund: ' || paid.label,
           CASE WHEN refund.state = 'confirmed' OR refund.state = 'released'
                THEN 'completed' ELSE 'pending' END,
           -- Dated when sent, and listed only once it was sent: the date is
           -- set once and never changes, so a row can not move between
           -- keyset pages (an unsent needs_review refund used to show at its
           -- creation date, then jump to its sending date) (Muse).
           refund.dispatched_at
      FROM piggyvest_primary.wallet_payment_refunds AS refund
      JOIN paid ON paid.id = refund.payment_id
     -- Only a refund of a listed spend (money that moved), so a refund never
     -- shows without the spend it returns (Muse).
     WHERE paid.listed
       AND refund.dispatched_at IS NOT NULL
       AND (refund.state IN ('dispatched', 'confirmed')
            -- A failed transfer that only charged a fee credited nothing:
            -- never shown as money coming in (Codex P2).
            OR (refund.state = 'needs_review'
                AND refund.review_reason IS DISTINCT FROM 'failed_with_fee')
            -- A released attempt later proven successful (it credited the
            -- customer while another attempt was live) is a refund too.
            OR (refund.state = 'released' AND refund.review_reason = 'late_refund_success'
                AND refund.provider_transaction_id IS NOT NULL))
  )
  -- Labels carry free text (biller names, goal titles): capped well under
  -- the row schema's 600 characters so one long name never fails a page.
  SELECT movement.id, movement.kind, movement.direction, movement.amount_kobo,
         movement.fee_kobo, pg_catalog.left(movement.label, 120), movement.status, movement.occurred_at
    FROM movements AS movement
   -- A row the page schema would refuse (no positive amount, no date) is
   -- left out, never failing the whole page (Muse); amounts are positive
   -- by every ledger's own checks, so this only guards a corrupt row.
   WHERE movement.amount_kobo > 0
     AND movement.occurred_at IS NOT NULL
     AND NULLIF(movement.label, '') IS NOT NULL
     AND (p_before_at IS NULL
          OR (movement.occurred_at, movement.id) < (p_before_at, p_before_id))
   ORDER BY movement.occurred_at DESC, movement.id DESC
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer) IS
  'The signed-in customer''s own PiggyVest main-wallet movements for one store, newest first (keyset by occurred_at, id), including purchases paid from the wallet and their refunds. Customer-facing fields only. Read-only.';

REVOKE ALL ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer)
TO authenticated;

COMMIT;
