-- Keep an account stable while any order-bound payment evidence is unresolved.
CREATE OR REPLACE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id AND (
    EXISTS (
      SELECT 1 FROM private.paid_order_offline_disbursements claim
      WHERE claim.merchant_id = OLD.merchant_id
        AND claim.account_id = OLD.bank_account_id
        AND claim.evidence_id IS NULL
    ) OR EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence entry
      WHERE entry.merchant_id = OLD.merchant_id
        AND entry.account_id = OLD.bank_account_id
        AND entry.direction = 'incoming'
        AND ((entry.bound_order_id IS NOT NULL AND entry.allocation IS NULL)
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'unapplied'))
    )
  ) THEN
    RAISE EXCEPTION 'bank_return_claim_open';
  END IF;
  RETURN NEW;
END;
$$;

-- Treat receipt replay as merchant-scoped across account rotations, while
-- requiring new receipts to use the currently configured account and cutover.
CREATE OR REPLACE FUNCTION public.register_paid_order_tender_receipt(
  p_order_id uuid,p_method text,p_receipt_reference text,p_reconciliation_reference text,
  p_amount_minor bigint,p_occurred_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  c private.paid_order_amendment_config%ROWTYPE;
  e private.paid_order_bank_evidence%ROWTYPE;
  replay_count bigint;
  receipt_key text := 'tender:' || p_method || ':' || upper(p_receipt_reference);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'bank_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_method,'') NOT IN ('cash','pos')
    OR COALESCE(p_receipt_reference,'') !~ '^[A-Za-z0-9_.:/-]{8,100}$'
    OR length(COALESCE(p_reconciliation_reference,'')) NOT BETWEEN 8 AND 160
    OR p_occurred_at IS NULL OR p_occurred_at > clock_timestamp()
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tender_evidence_required'; END IF;
  SELECT * INTO c FROM private.paid_order_amendment_config
  WHERE merchant_id = o.merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tender_evidence_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO STRICT o FROM public.orders WHERE id = p_order_id FOR UPDATE;

  SELECT count(*) INTO replay_count FROM private.paid_order_bank_evidence
  WHERE merchant_id = o.merchant_id AND bank_transaction_id = receipt_key;
  IF replay_count > 1 THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  IF replay_count = 1 THEN
    SELECT * INTO STRICT e FROM private.paid_order_bank_evidence
    WHERE merchant_id = o.merchant_id AND bank_transaction_id = receipt_key;
    IF ROW(e.direction,e.currency,e.bound_order_id,e.collection_method,e.amount_minor,
        e.occurred_at,e.statement_entry)
      IS DISTINCT FROM ROW('incoming','NGN',o.id,p_method,p_amount_minor,
        p_occurred_at,p_reconciliation_reference) THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    RETURN e.id;
  END IF;

  IF c.bank_account_id IS NULL OR p_occurred_at < c.bank_evidence_cutover THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  IF p_receipt_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,99}$' THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  IF NOT c.enabled OR NOT c.verified_cash_pos_enabled OR o.payment_status <> 'paid'
    OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
    OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'scenario_disabled';
  END IF;
  INSERT INTO private.paid_order_bank_evidence(merchant_id,account_id,bank_transaction_id,
    direction,amount_minor,currency,occurred_at,statement_entry,bound_order_id,collection_method)
  VALUES (o.merchant_id,c.bank_account_id,receipt_key,
    'incoming',p_amount_minor,'NGN',p_occurred_at,p_reconciliation_reference,o.id,p_method)
  RETURNING id INTO e.id;
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz) TO service_role;
