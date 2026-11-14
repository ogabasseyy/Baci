-- Paid-interest notification wording and progress text.
--
-- Both paid-interest notifiers (PiggyVest primary-wallet payouts and the
-- legacy savings ledger) now read "Your savings just grew 🎉" and
-- "₦X interest added to your savings. <progress>", where <progress> is the
-- goal's position after the credit: principal plus net paid interest (paid
-- interest less reversals), against the goal target. That is the same
-- per-goal interest the app's savings display adds, so interest reserved for
-- a purchase is left out until it is released, as it is in the app. Below the target it is a floored percentage or,
-- under 1%, the naira amount left. At or past the target it points to the
-- live balance and never claims completion, which only the reversal-aware
-- goal-completed notice announces.
--
-- Besides the copy, one firing condition changes: the primary-wallet notifier
-- now announces only receipts of a production integration owned by the
-- receipt's merchant, the same interest the app's savings display counts. Each
-- notifier otherwise still fires only for recorded paid interest with a
-- positive amount, keeps its event key, and still never fires for accruals
-- (pending interest) or reversals; reversals keep voiding the original notice.
--
-- The two helpers are SECURITY INVOKER and called only from the SECURITY
-- DEFINER notifier triggers (which run as their owner), so no API role is
-- granted EXECUTE on any of the four functions. If the progress text cannot
-- be computed, the notice falls back to the neutral balance prompt; the
-- payout or ledger credit is always recorded.
--
-- Consolidates the PR #3808 drafts 20261013123000, 20261013191500
-- and 20261013194000 into their final state. Append-only.
BEGIN;

CREATE OR REPLACE FUNCTION savings_notifications.progress_message(p_saved_kobo numeric, p_target_kobo numeric)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE v_progress integer;
BEGIN
  IF p_saved_kobo IS NULL OR p_target_kobo IS NULL OR p_saved_kobo < 0 OR p_target_kobo <= 0
    OR p_saved_kobo::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_target_kobo::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN 'Open your savings to see your latest balance.';
  END IF;
  -- At or past the target the text never claims completion: a later reversal
  -- can take the goal back below target, and nothing withdraws an interest
  -- notice's wording. The goal-completed notice, which is voided when
  -- completion is reversed, stays the only completion announcement.
  IF p_saved_kobo >= p_target_kobo THEN
    RETURN 'Open your savings to see your latest balance.';
  END IF;
  v_progress := floor(p_saved_kobo * 100 / p_target_kobo)::integer;
  IF v_progress > 0 THEN
    RETURN 'You’re now ' || v_progress || '% of the way there.';
  END IF;
  RETURN '₦' || to_char((p_target_kobo - p_saved_kobo) / 100, 'FM999,999,999,999,990.00')
    || ' left to reach your goal.';
END $$;

-- VOLATILE so every read takes a fresh snapshot and sees the credit the
-- calling AFTER INSERT trigger is announcing.
CREATE OR REPLACE FUNCTION savings_notifications.interest_progress(p_goal uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  v_merchant uuid;
  v_customer uuid;
  v_principal numeric;
  v_target numeric;
  v_status text;
  v_ledger_interest numeric;
  v_primary_interest numeric;
BEGIN
  SELECT goal.merchant_id, goal.customer_id, goal.current_amount, goal.target_amount, goal.status
    INTO v_merchant, v_customer, v_principal, v_target, v_status
    FROM public.customer_savings_goals goal WHERE goal.id = p_goal;
  -- get_customer_savings_earnings reports per-goal interest only for these
  -- statuses; any other goal gets the neutral prompt (NULL status included).
  IF NOT FOUND OR v_status IS NULL OR v_status NOT IN ('active', 'paused', 'completed') THEN
    RETURN savings_notifications.progress_message(NULL, NULL);
  END IF;
  -- Count only paid_interest postings and production receipts, exactly as the per-goal interest of
  -- get_customer_savings_earnings (the app's savings display) does, so the
  -- notice never reads higher than the balance the customer then opens.
  SELECT coalesce(sum(posting.amount_kobo), 0) INTO v_ledger_interest
    FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
    WHERE operation.goal_id = p_goal AND operation.merchant_id = v_merchant
      AND operation.customer_id = v_customer
      AND posting.account = 'paid_interest';
  SELECT coalesce(sum(receipt.net_kobo - coalesce(reversal.amount_kobo, 0)), 0) INTO v_primary_interest
    FROM piggyvest_primary.paid_interest_receipts receipt
    JOIN piggyvest_primary.integrations integration ON integration.id = receipt.integration_id
      AND integration.environment = 'production' AND integration.merchant_id = receipt.merchant_id
    LEFT JOIN LATERAL (
      SELECT sum(reversed.amount_kobo) AS amount_kobo
      FROM piggyvest_primary.paid_interest_reversals reversed
      WHERE reversed.integration_id = receipt.integration_id AND reversed.payout_id = receipt.payout_id
    ) reversal ON true
    WHERE receipt.goal_id = p_goal AND receipt.merchant_id = v_merchant
      AND receipt.customer_id = v_customer;
  RETURN savings_notifications.progress_message(
    v_principal * 100 + v_ledger_interest + v_primary_interest, v_target * 100);
END $$;

-- Both notifiers run in the same transaction as the money write they
-- announce, so the progress text is computed in its own block: any error
-- there falls back to the neutral balance prompt instead of rolling back the
-- payout receipt or ledger credit. Recording the money never depends on
-- notification wording.
CREATE OR REPLACE FUNCTION piggyvest_primary.notify_paid_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_progress text;
BEGIN
  -- Only production receipts are interest the app's savings display counts, so
  -- only they are announced.
  IF NEW.net_kobo > 0 AND EXISTS (
    SELECT 1 FROM piggyvest_primary.integrations integration
    WHERE integration.id = NEW.integration_id AND integration.environment = 'production'
      AND integration.merchant_id = NEW.merchant_id) THEN
    BEGIN
      v_progress := savings_notifications.interest_progress(NEW.goal_id);
    EXCEPTION WHEN OTHERS THEN
      v_progress := NULL;
    END;
    PERFORM savings_notifications.emit(NEW.goal_id,
      'primary-interest:' || NEW.integration_id::text || ':' || NEW.payout_id,
      'interest_credited', 'Your savings just grew 🎉',
      '₦' || to_char(NEW.net_kobo::numeric / 100, 'FM999,999,999,999,990.00')
        || ' interest added to your savings. '
        || coalesce(v_progress, 'Open your savings to see your latest balance.'));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION savings_notifications.interest_recorded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_goal uuid;
  v_merchant uuid;
  v_customer uuid;
  v_kind text;
  v_reference uuid;
  v_progress text;
BEGIN
  IF NEW.account <> 'paid_interest' THEN RETURN NEW; END IF;
  SELECT operation.goal_id, operation.merchant_id, operation.customer_id,
      operation.command->>'kind', operation.reference_id
    INTO STRICT v_goal, v_merchant, v_customer, v_kind, v_reference
    FROM piggyvest_savings_ledger.operations operation WHERE operation.id = NEW.operation_id;
  IF v_kind = 'credit_eligible_paid_interest' AND NEW.amount_kobo > 0 THEN
    BEGIN
      v_progress := savings_notifications.interest_progress(v_goal);
    EXCEPTION WHEN OTHERS THEN
      v_progress := NULL;
    END;
    PERFORM savings_notifications.emit(v_goal, 'interest:' || NEW.operation_id, 'interest_credited',
      'Your savings just grew 🎉', '₦' || to_char(NEW.amount_kobo::numeric / 100, 'FM999,999,999,999,990.00')
        || ' interest added to your savings. '
        || coalesce(v_progress, 'Open your savings to see your latest balance.'));
  ELSIF v_kind = 'reverse_credit' AND NEW.amount_kobo < 0 THEN
    UPDATE savings_notifications.events SET voided_at = now()
      WHERE merchant_id = v_merchant AND customer_id = v_customer
        AND goal_id = v_goal AND event_key = 'interest:' || v_reference;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION savings_notifications.progress_message(numeric, numeric),
  savings_notifications.interest_progress(uuid),
  piggyvest_primary.notify_paid_interest(),
  savings_notifications.interest_recorded()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
