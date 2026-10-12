BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.apply_bound(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  operation uuid;
  reference uuid;
  kind text;
  principal bigint;
  interest bigint;
  stored piggyvest_savings_ledger.operations%ROWTYPE;
  referenced piggyvest_savings_ledger.operations%ROWTYPE;
  amounts jsonb := '{}'::jsonb;
  entry record;
  balance numeric;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ledger requires read committed' USING ERRCODE = '25000';
  END IF;
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_command)) <> 6
    OR NOT p_command ?& ARRAY['operationId','kind','principalKobo','interestKobo','evidenceId','referenceId']
    OR jsonb_typeof(p_command->'operationId') <> 'string'
    OR jsonb_typeof(p_command->'kind') <> 'string'
    OR jsonb_typeof(p_command->'evidenceId') <> 'string'
    OR (p_command->>'evidenceId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR jsonb_typeof(p_command->'principalKobo') <> 'number'
    OR jsonb_typeof(p_command->'interestKobo') <> 'number'
    OR jsonb_typeof(p_command->'referenceId') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'ledger invalid command' USING ERRCODE = '22023';
  END IF;
  IF (p_command->>'principalKobo')::numeric NOT BETWEEN 0 AND 9007199254740991
    OR (p_command->>'interestKobo')::numeric NOT BETWEEN 0 AND 9007199254740991
    OR trunc((p_command->>'principalKobo')::numeric) <> (p_command->>'principalKobo')::numeric
    OR trunc((p_command->>'interestKobo')::numeric) <> (p_command->>'interestKobo')::numeric THEN
    RAISE EXCEPTION 'ledger invalid command' USING ERRCODE = '22023';
  END IF;
  operation := (p_command->>'operationId')::uuid;
  reference := (p_command->>'referenceId')::uuid;
  kind := p_command->>'kind';
  principal := (p_command->>'principalKobo')::numeric::bigint;
  interest := (p_command->>'interestKobo')::numeric::bigint;
  IF principal + interest > 9007199254740991 OR NOT (CASE
    WHEN kind IN ('release_purchase','settle_reservation','reverse_credit')
      THEN reference IS NOT NULL AND principal = 0 AND interest = 0
    WHEN kind IN ('credit_principal','reserve_refund')
      THEN reference IS NULL AND principal > 0 AND interest = 0
    WHEN kind IN ('record_pending_interest','credit_eligible_paid_interest')
      THEN reference IS NULL AND principal = 0 AND interest > 0
    WHEN kind = 'reserve_purchase' THEN reference IS NULL AND principal + interest > 0
    ELSE false END) THEN
    RAISE EXCEPTION 'ledger invalid command' USING ERRCODE = '22023';
  END IF;
  PERFORM binding.goal_id FROM piggyvest_savings_ledger.bindings binding
    WHERE binding.goal_id = p_goal AND binding.integration_id = p_integration
      AND binding.merchant_id = p_merchant AND binding.customer_id = p_customer
      AND binding.enabled AND binding.authorized_login = session_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger caller or binding denied' USING ERRCODE = '42501'; END IF;
  PERFORM customer.id FROM public.customers customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal
    WHERE goal.id = p_goal AND goal.customer_id = p_customer AND goal.merchant_id = p_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger ownership mismatch'; END IF;
  SELECT saved.id, saved.integration_id, saved.merchant_id, saved.customer_id, saved.goal_id,
    saved.command, saved.evidence_id, saved.reference_id, saved.created_at, saved.created_xid
    INTO stored FROM piggyvest_savings_ledger.operations saved
    WHERE saved.id = operation OR (saved.integration_id = p_integration AND saved.evidence_id = p_command->>'evidenceId')
    ORDER BY saved.id LIMIT 1;
  IF FOUND THEN
    IF stored.id <> operation OR stored.command <> p_command OR stored.integration_id <> p_integration
      OR stored.goal_id <> p_goal OR stored.merchant_id <> p_merchant OR stored.customer_id <> p_customer THEN
      RAISE EXCEPTION 'ledger idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('operationId', operation, 'outcome', 'recorded');
  END IF;
  IF reference IS NOT NULL THEN
    SELECT saved.id, saved.integration_id, saved.merchant_id, saved.customer_id, saved.goal_id,
      saved.command, saved.evidence_id, saved.reference_id, saved.created_at, saved.created_xid
      INTO referenced FROM piggyvest_savings_ledger.operations saved
      WHERE saved.id = reference AND saved.goal_id = p_goal AND saved.integration_id = p_integration;
    IF NOT FOUND THEN RAISE EXCEPTION 'ledger invalid reference'; END IF;
    IF EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations WHERE reference_id = reference) THEN
      RAISE EXCEPTION 'ledger reference consumed';
    END IF;
    IF kind = 'reverse_credit' THEN
      IF referenced.command->>'kind' NOT IN ('credit_principal','record_pending_interest','credit_eligible_paid_interest') THEN
        RAISE EXCEPTION 'ledger invalid reference';
      END IF;
      SELECT jsonb_object_agg(account, -amount_kobo) INTO amounts
        FROM piggyvest_savings_ledger.postings WHERE operation_id = reference;
    ELSE
      IF referenced.command->>'kind' NOT IN ('reserve_purchase','reserve_refund')
        OR (kind = 'release_purchase' AND referenced.command->>'kind' <> 'reserve_purchase') THEN
        RAISE EXCEPTION 'ledger invalid reference';
      END IF;
      principal := (referenced.command->>'principalKobo')::numeric::bigint;
      interest := (referenced.command->>'interestKobo')::numeric::bigint;
      amounts := jsonb_build_object(
        CASE WHEN referenced.command->>'kind' = 'reserve_refund' THEN 'refund_principal' ELSE 'purchase_principal' END, -principal,
        'purchase_interest', -interest);
      IF kind = 'release_purchase' THEN
        amounts := amounts || jsonb_build_object('principal', principal, 'paid_interest', interest);
      ELSE
        amounts := amounts || jsonb_build_object('internal_clearing', principal + interest);
      END IF;
    END IF;
  ELSIF kind IN ('reserve_purchase','reserve_refund') THEN
    IF EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations reservation
      WHERE reservation.goal_id = p_goal AND reservation.command->>'kind' IN ('reserve_purchase','reserve_refund')
      AND NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations resolution WHERE resolution.reference_id = reservation.id)) THEN
      RAISE EXCEPTION 'ledger reservation conflict';
    END IF;
    amounts := jsonb_build_object('principal', -principal, 'paid_interest', -interest,
      CASE WHEN kind = 'reserve_refund' THEN 'refund_principal' ELSE 'purchase_principal' END, principal,
      'purchase_interest', interest);
  ELSE
    amounts := CASE kind
      WHEN 'credit_principal' THEN jsonb_build_object('principal', principal, 'internal_clearing', -principal)
      WHEN 'credit_eligible_paid_interest' THEN jsonb_build_object('paid_interest', interest, 'internal_clearing', -interest)
      WHEN 'record_pending_interest' THEN jsonb_build_object('pending_interest', interest, 'pending_clearing', -interest)
    END;
  END IF;
  FOR entry IN SELECT key, value::bigint AS delta FROM jsonb_each_text(amounts) LOOP
    SELECT coalesce(sum(posting.amount_kobo),0) INTO balance
      FROM piggyvest_savings_ledger.postings posting
      JOIN piggyvest_savings_ledger.operations saved ON saved.id = posting.operation_id
      WHERE saved.goal_id = p_goal AND posting.account = entry.key;
    balance := balance + entry.delta;
    IF entry.key NOT IN ('internal_clearing','pending_clearing') AND balance < 0 THEN
      RAISE EXCEPTION 'ledger insufficient funds';
    END IF;
    IF abs(balance) > 9007199254740991 THEN RAISE EXCEPTION 'ledger balance overflow'; END IF;
  END LOOP;
  INSERT INTO piggyvest_savings_ledger.operations
    (id, integration_id, merchant_id, customer_id, goal_id, command, evidence_id, reference_id)
    VALUES (operation, p_integration, p_merchant, p_customer, p_goal, p_command, p_command->>'evidenceId', reference);
  INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
    SELECT operation, key, value::bigint FROM jsonb_each_text(amounts) WHERE value::bigint <> 0;
  RETURN jsonb_build_object('operationId', operation, 'outcome', 'recorded');
END $$;
COMMIT;
