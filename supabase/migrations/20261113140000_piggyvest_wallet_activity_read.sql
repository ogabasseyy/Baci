-- PiggyVest wallet activity: the signed-in customer's own main-wallet
-- movements, newest first, for the storefront list under the wallet card.
--
-- Every PiggyVest ledger denies customers (RESTRICTIVE USING (false) plus
-- REVOKE), and since 20261103025419 deposits are written to the receipt
-- ledger only, so the legacy customer_wallet_transactions list cannot show
-- them. This read joins the ledgers through the caller's OWN onboarding
-- intent (user_id = auth.uid(), the store passed in, the customer row of the
-- same user and store) and returns customer-facing fields only:
--
--   deposits        piggyvest_primary.inflow_receipts        money in
--   contributions   piggyvest_primary.savings_operations     money out
--   goal cancels    piggyvest_primary.goal_cancel_operations money in
--   goal completes  piggyvest_primary.goal_complete_operations money in
--
-- Never returned: provider customer, wallet or transaction ids, references,
-- event ids, fingerprints, review notes. Deposits report the amount that
-- reached the wallet (transfer amount less PiggyVest's deposit fee) and the
-- fee on its own; every other row has a zero fee. The row id is the ledger row's own
-- uuid (a stable list key and pagination tie-break, meaningless outside).
--
-- Not covered because nothing records them yet: spends paid from the main
-- wallet (IMEI checks, airtime/data/bills). primary-readiness-registry marks
-- both notRegistered; they are listed as owed, not invented here.
--
-- Read-only and STABLE: it changes no state. No table policy is added or
-- changed (in particular none keyed on a table's own primary key).

BEGIN;

-- A receipt's provider timestamp, or NULL when it is missing or unreadable:
-- one malformed value must never fail a customer's whole activity list.
CREATE FUNCTION piggyvest_primary.parse_receipt_credited_at(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
BEGIN
  RETURN p_value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION piggyvest_primary.parse_receipt_credited_at(text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.list_piggyvest_wallet_activity(
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
    SELECT intent.id AS intent_id
      FROM piggyvest_primary.onboarding_intents AS intent
      JOIN public.customers AS customer
        ON customer.id = intent.customer_id
       AND customer.merchant_id = intent.merchant_id
       AND customer.user_id = intent.user_id
     WHERE intent.user_id = v_user
       AND intent.merchant_id = p_merchant_id
       AND intent.state IN ('accepted', 'verified')
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
           -- When the money reached the wallet, not when a late or replayed
           -- event was processed; never later than the row itself.
           LEAST(
             piggyvest_primary.parse_receipt_credited_at(
               receipt.financial_identity ->> 'creditedAt'),
             receipt.created_at) AS occurred_at
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
      LEFT JOIN public.customer_savings_goals AS goal ON goal.id = operation.goal_id
     WHERE operation.state IN ('reserved', 'dispatched', 'confirmed')
    UNION ALL
    -- Goal cancelled early: its balance returns to the wallet.
    SELECT cancel.id,
           'goal_refund',
           'in',
           cancel.amount_kobo,
           0::bigint,
           'Returned from ' || COALESCE(goal.title, 'a savings goal'),
           -- A review hold has already credited the wallet: spendable money.
           CASE WHEN cancel.state = 'dispatched' THEN 'pending' ELSE 'completed' END,
           -- Immutable ordering key: settling must not move a row across a
           -- page cursor.
           COALESCE(cancel.dispatched_at, cancel.reserved_at, cancel.issued_at)
      FROM piggyvest_primary.goal_cancel_operations AS cancel
      JOIN mine ON mine.intent_id = cancel.intent_id
      LEFT JOIN public.customer_savings_goals AS goal ON goal.id = cancel.goal_id
     WHERE cancel.state IN ('dispatched', 'confirmed', 'needs_review', 'reviewed')
       AND cancel.amount_kobo IS NOT NULL
    UNION ALL
    -- Goal completed: its full balance, interest included, returns to the wallet.
    SELECT complete.id,
           -- A review hold credits only the transferred amount and leaves the
           -- goal open: only a confirmed completion says "Goal completed".
           CASE WHEN complete.state = 'confirmed'
                THEN 'goal_completed' ELSE 'goal_refund' END,
           'in',
           complete.amount_kobo,
           0::bigint,
           CASE WHEN complete.state = 'confirmed'
                THEN 'Goal completed: ' || COALESCE(goal.title, 'savings goal')
                ELSE 'Returned from ' || COALESCE(goal.title, 'a savings goal') END,
           CASE WHEN complete.state = 'dispatched' THEN 'pending' ELSE 'completed' END,
           COALESCE(complete.dispatched_at, complete.reserved_at, complete.issued_at)
      FROM piggyvest_primary.goal_complete_operations AS complete
      JOIN mine ON mine.intent_id = complete.intent_id
      LEFT JOIN public.customer_savings_goals AS goal ON goal.id = complete.goal_id
     WHERE complete.state IN ('dispatched', 'confirmed', 'needs_review', 'reviewed')
       AND complete.amount_kobo IS NOT NULL
  )
  SELECT movement.id, movement.kind, movement.direction, movement.amount_kobo,
         movement.fee_kobo, movement.label, movement.status, movement.occurred_at
    FROM movements AS movement
   WHERE p_before_at IS NULL
      OR (movement.occurred_at, movement.id) < (p_before_at, p_before_id)
   ORDER BY movement.occurred_at DESC, movement.id DESC
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer) IS
  'The signed-in customer''s own PiggyVest main-wallet movements for one store, newest first (keyset by occurred_at, id). Customer-facing fields only. Read-only.';

REVOKE ALL ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_piggyvest_wallet_activity(uuid, timestamptz, uuid, integer)
TO authenticated;

COMMIT;
