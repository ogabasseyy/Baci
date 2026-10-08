BEGIN;
CREATE FUNCTION piggyvest_savings_ledger.snapshot(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE balances jsonb; reservation jsonb; reversed boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ledger requires read committed' USING ERRCODE = '25000';
  END IF;
  PERFORM binding.goal_id FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.goal_id = p_goal AND binding.integration_id = p_integration
      AND binding.merchant_id = p_merchant AND binding.customer_id = p_customer
      AND binding.enabled AND binding.authorized_login = session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger caller or binding denied' USING ERRCODE = '42501'; END IF;
  PERFORM customer.id FROM public.customers customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal
    WHERE goal.id = p_goal AND goal.customer_id = p_customer AND goal.merchant_id = p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  SELECT jsonb_build_object(
    'confirmedPrincipalKobo', coalesce(sum(posting.amount_kobo) FILTER (WHERE account IN ('principal','purchase_principal','refund_principal')),0),
    'reservedPrincipalKobo', coalesce(sum(posting.amount_kobo) FILTER (WHERE account IN ('purchase_principal','refund_principal')),0),
    'paidEligibleInterestKobo', coalesce(sum(posting.amount_kobo) FILTER (WHERE account IN ('paid_interest','purchase_interest')),0),
    'reservedPaidInterestKobo', coalesce(sum(posting.amount_kobo) FILTER (WHERE account = 'purchase_interest'),0),
    'pendingInterestKobo', coalesce(sum(posting.amount_kobo) FILTER (WHERE account = 'pending_interest'),0)
  ) INTO balances FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations saved ON saved.id = posting.operation_id WHERE saved.goal_id = p_goal;
  SELECT jsonb_build_object('operationId', saved.id, 'kind', saved.command->>'kind',
    'principalKobo', saved.command->'principalKobo', 'interestKobo', saved.command->'interestKobo')
    INTO reservation FROM piggyvest_savings_ledger.operations saved
    WHERE saved.goal_id = p_goal AND saved.command->>'kind' IN ('reserve_purchase','reserve_refund')
    AND NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations resolution WHERE resolution.reference_id = saved.id);
  SELECT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations reversal
    JOIN piggyvest_savings_ledger.operations credit ON credit.id = reversal.reference_id
    WHERE reversal.goal_id = p_goal AND reversal.command->>'kind' = 'reverse_credit'
      AND credit.command->>'kind' IN ('credit_principal','credit_eligible_paid_interest')) INTO reversed;
  RETURN jsonb_build_object('ledger', balances, 'activeReservation', reservation, 'fundingReversed', reversed);
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) IS
  'Private internally consistent snapshot under shared binding/goal locks, dedicated session_user binding required. Ledger totals INCLUDE reservations; policy must subtract reservations once. Pending is separate and nonspendable. fundingReversed remains conservatively true after any principal/paid credit reversal; review clearance is intentionally not implemented. Does not verify provider cash, lifecycle, price, consent or eligibility.';
COMMIT;
