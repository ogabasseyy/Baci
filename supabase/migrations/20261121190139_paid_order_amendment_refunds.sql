ALTER TABLE private.paid_order_amendment_config
  ADD COLUMN automated_paystack_refunds boolean NOT NULL DEFAULT false;

CREATE TABLE private.paid_order_amendment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id uuid NOT NULL REFERENCES private.paid_order_amendments(id),
  payment_id uuid NOT NULL REFERENCES public.transactions(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reference text NOT NULL UNIQUE,
  integration_id bigint NOT NULL CHECK (integration_id > 0),
  domain text NOT NULL CHECK (domain IN ('test','live')),
  capture_id text NOT NULL CHECK (capture_id ~ '^[1-9][0-9]{0,19}$'),
  capture_reference text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','uncertain','pending','processing','needs_attention','failed','processed','void')),
  provider_refund_id text CHECK (provider_refund_id ~ '^[1-9][0-9]{0,19}$'),
  refund_transaction_id uuid UNIQUE REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_lookup_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id,domain,provider_refund_id)
);
CREATE UNIQUE INDEX paid_order_amendment_refund_active_idx ON private.paid_order_amendment_refunds(amendment_id)
  WHERE state IN ('queued','uncertain','pending','processing','needs_attention');
CREATE INDEX paid_order_amendment_refund_due_idx ON private.paid_order_amendment_refunds(next_lookup_at)
  WHERE state IN ('queued','uncertain','pending','processing','needs_attention');

-- Finance's adjustment decision and wallet posting are attributable to a single verified refund.
CREATE TABLE private.paid_order_amendment_adjustments (
  refund_id uuid PRIMARY KEY REFERENCES private.paid_order_amendment_refunds(id),
  settlement_id uuid NOT NULL REFERENCES public.merchant_settlements(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  finance_reference text NOT NULL UNIQUE CHECK (length(finance_reference) BETWEEN 8 AND 160),
  original_net_amount numeric NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.paid_order_amendment_finance_approvals (
  refund_id uuid PRIMARY KEY REFERENCES private.paid_order_amendment_refunds(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  finance_reference text NOT NULL UNIQUE CHECK (length(finance_reference) BETWEEN 8 AND 160),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.paid_order_amendment_finance_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_amendment_finance_approvals FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE private.paid_order_amendment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_amendment_refunds, private.paid_order_amendment_adjustments
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.queue_paid_order_amendment_refund(a private.paid_order_amendments, p_payment_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  p public.transactions%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
  attempt uuid := gen_random_uuid();
BEGIN
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id;
  SELECT * INTO p FROM public.transactions WHERE id = p_payment_id AND merchant_id = a.merchant_id
    AND order_id = a.order_id AND status = 'completed' AND gateway = 'paystack' AND currency = 'NGN';
  IF NOT FOUND OR config.paystack_integration_id IS NULL
    OR COALESCE(p.gateway_response->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR COALESCE(p.gateway_response->>'domain','') NOT IN ('test','live')
    OR (p.gateway_response->>'integration' IS NOT NULL
      AND p.gateway_response->>'integration' <> config.paystack_integration_id::text)
    OR a.refund_owed_minor <= 0 OR a.refund_owed_minor >= p.amount * 100
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id = a.order_id
      AND t.transaction_type = 'refund' AND t.status NOT IN ('failed','cancelled')) THEN
    RETURN NULL;
  END IF;
  INSERT INTO private.paid_order_amendment_refunds(id,amendment_id,payment_id,amount_minor,reference,integration_id,
    domain,capture_id,capture_reference,state)
  VALUES (attempt,a.id,p.id,a.refund_owed_minor,'BAC-AMEND-' || attempt,config.paystack_integration_id,
    p.gateway_response->>'domain',p.gateway_response->>'id',p.gateway_reference,'queued');
  RETURN attempt;
END;
$$;

CREATE FUNCTION private.queue_confirmed_paid_order_amendment_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  attempt uuid;
BEGIN
  IF NEW.event_type <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = NEW.amendment_id;
  IF a.state <> 'awaiting_refund' THEN RETURN NEW; END IF;
  attempt := private.queue_paid_order_amendment_refund(a,(NEW.details->>'captureId')::uuid);
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,NEW.actor_id,CASE WHEN attempt IS NULL THEN 'refund_evidence_review' ELSE 'refund_queued' END,
    jsonb_build_object('operationId',attempt,'amountMinor',a.refund_owed_minor));
  RETURN NEW;
END;
$$;
CREATE TRIGGER paid_order_amendment_confirmed_refund
AFTER INSERT ON private.paid_order_amendment_events
FOR EACH ROW EXECUTE FUNCTION private.queue_confirmed_paid_order_amendment_refund();
REVOKE ALL ON FUNCTION private.queue_paid_order_amendment_refund(private.paid_order_amendments,uuid),
  private.queue_confirmed_paid_order_amendment_refund() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.list_due_paid_order_amendment_refunds(p_limit integer)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT r.id FROM private.paid_order_amendment_refunds r
  JOIN private.paid_order_amendments a ON a.id = r.amendment_id
  JOIN private.paid_order_amendment_config c ON c.merchant_id = a.merchant_id
  WHERE r.next_lookup_at <= now() AND a.state = 'awaiting_refund'
    AND (r.state IN ('uncertain','pending','processing','needs_attention')
      OR (r.state = 'queued' AND c.enabled AND c.automated_paystack_refunds))
  ORDER BY r.next_lookup_at,r.id LIMIT greatest(0,least(p_limit,20));
END;
$$;

-- Lease preflight work separately from dispatch. A failed config or history
-- check can retry without marking an undispatched refund as uncertain.
CREATE FUNCTION public.claim_paid_order_amendment_refund(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
  submit boolean;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = a.id;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt FOR UPDATE;
  IF a.state <> 'awaiting_refund' OR r.state IN ('failed','processed','void')
    OR r.next_lookup_at > clock_timestamp() THEN RETURN NULL; END IF;
  submit := r.state = 'queued';
  IF submit AND (NOT COALESCE(config.enabled AND config.automated_paystack_refunds,false)
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id
    OR EXISTS (SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled'))) THEN RETURN NULL; END IF;
  UPDATE private.paid_order_amendment_refunds
  SET next_lookup_at = clock_timestamp() + interval '5 minutes' WHERE id = r.id;
  RETURN jsonb_build_object('submit',submit,'reference',r.reference,'captureReference',r.capture_reference,
    'captureId',r.capture_id,'amountMinor',r.amount_minor,'integrationId',r.integration_id::text,'domain',r.domain);
END;
$$;

-- The worker calls this after checking the provider account and history,
-- immediately before POST. Recovery can void a queued attempt before then.
CREATE FUNCTION public.authorize_paid_order_amendment_refund_dispatch(p_attempt uuid,p_clear boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = a.id;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt FOR UPDATE;
  IF p_clear IS NULL OR a.state <> 'awaiting_refund' OR r.state <> 'queued'
    OR NOT COALESCE(config.enabled AND config.automated_paystack_refunds,false)
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled')) THEN p_clear := false; END IF;
  UPDATE private.paid_order_amendment_refunds
    SET state = CASE WHEN p_clear THEN 'uncertain' ELSE 'needs_attention' END,
      next_lookup_at = clock_timestamp() + interval '5 minutes'
    WHERE id = r.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,CASE WHEN p_clear THEN 'refund_submission_claimed' ELSE 'refund_evidence_review' END,
      jsonb_build_object('operationId',r.id,'amountMinor',r.amount_minor));
  RETURN p_clear;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_paid_order_amendment_refund_dispatch(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_paid_order_amendment_refund_dispatch(uuid,boolean) TO service_role;

CREATE FUNCTION public.find_paid_order_amendment_refund(p_reference text, p_provider_id text, p_capture_reference text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  match_reference text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT reference INTO match_reference FROM private.paid_order_amendment_refunds
  WHERE lower(reference) = lower(p_reference);
  IF FOUND THEN RETURN match_reference; END IF;
  SELECT CASE WHEN count(*) = 1 THEN min(reference) END INTO match_reference
  FROM private.paid_order_amendment_refunds WHERE provider_refund_id = p_provider_id;
  IF match_reference IS NOT NULL THEN RETURN match_reference; END IF;
  -- Some events only name the capture. That selects an unresolved operation
  -- for lookup by its own reference. The event itself cannot settle it.
  SELECT CASE WHEN count(*) = 1 THEN min(reference) END INTO match_reference
  FROM private.paid_order_amendment_refunds WHERE capture_reference = p_capture_reference
    AND state IN ('uncertain','pending','processing','needs_attention');
  RETURN match_reference;
END;
$$;

CREATE FUNCTION public.record_paid_order_amendment_refund(p_reference text,p_evidence jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  new_state text := p_evidence->>'status';
  refund_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.reference = p_reference;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE reference = p_reference FOR UPDATE;
  IF p_evidence->>'reference' IS DISTINCT FROM r.reference
    OR p_evidence->>'transactionId' IS DISTINCT FROM r.capture_id
    OR p_evidence->>'integration' IS DISTINCT FROM r.integration_id::text
    OR p_evidence->>'domain' IS DISTINCT FROM r.domain
    OR p_evidence->>'currency' IS DISTINCT FROM 'NGN'
    OR p_evidence->>'amount' IS DISTINCT FROM r.amount_minor::text
    OR COALESCE(p_evidence->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR (r.provider_refund_id IS NOT NULL AND r.provider_refund_id IS DISTINCT FROM p_evidence->>'id')
    OR COALESCE(new_state,'') NOT IN ('pending','processing','needs_attention','processed','failed')
    OR EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds other
      WHERE other.id <> r.id AND other.integration_id = r.integration_id AND other.domain = r.domain
        AND other.provider_refund_id = p_evidence->>'id') THEN
    RETURN 'evidence_mismatch';
  END IF;
  IF r.state = 'processed' THEN RETURN 'processed'; END IF;
  IF r.state IN ('queued','void','failed') THEN
    RETURN CASE WHEN r.state = 'failed' AND new_state = 'failed' THEN 'failed' ELSE 'evidence_mismatch' END;
  END IF;
  IF r.state IN ('processing','needs_attention') AND new_state = 'pending' THEN RETURN r.state; END IF;
  UPDATE private.paid_order_amendment_refunds
  SET state = new_state, provider_refund_id = p_evidence->>'id'
  WHERE id = r.id;
  IF new_state = 'processed' THEN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
    VALUES (a.merchant_id,a.order_id,'refund',r.amount_minor::numeric/100,'NGN','completed','paystack',
      p_evidence->>'id',jsonb_build_object('payment_transaction_id',r.payment_id,'paid_order_amendment_refund_id',r.id,
        'provider_refund_status','processed','provider_refund_id',p_evidence->>'id','amendment_refund_reference',r.reference))
    RETURNING id INTO refund_id;
  END IF;
  UPDATE private.paid_order_amendment_refunds
  SET refund_transaction_id = refund_id WHERE id = r.id AND refund_id IS NOT NULL;
  IF r.state <> new_state THEN
    INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,CASE WHEN new_state = 'processed' THEN 'customer_refund_verified' ELSE 'refund_status_changed' END,
      jsonb_build_object('operationId',r.id,'state',new_state,'transactionId',refund_id,
        'merchantAdjustmentPending',new_state = 'processed'));
  END IF;
  RETURN new_state;
END;
$$;

CREATE FUNCTION private.post_paid_order_amendment_adjustment(
  p_attempt uuid,p_merchant_debit_minor bigint,p_finance_reference text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  s public.merchant_settlements%ROWTYPE;
  adjustment private.paid_order_amendment_adjustments%ROWTYPE;
  debit numeric := p_merchant_debit_minor::numeric / 100;
  wallet_balance numeric;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_finance_worker_required' USING ERRCODE = '42501';
  END IF;
  IF p_merchant_debit_minor IS NULL OR p_merchant_debit_minor < 0
    OR p_finance_reference IS NULL OR length(btrim(p_finance_reference)) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'invalid_amendment_adjustment' USING ERRCODE = '22023';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt;
  SELECT * INTO adjustment FROM private.paid_order_amendment_adjustments WHERE refund_id = r.id;
  IF FOUND THEN
    IF adjustment.amount_minor IS DISTINCT FROM p_merchant_debit_minor
      OR adjustment.finance_reference IS DISTINCT FROM btrim(p_finance_reference) THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RETURN private.paid_order_amendment_summary(a.order_id);
  END IF;
  IF r.state <> 'processed' OR r.refund_transaction_id IS NULL THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  SELECT * INTO s FROM public.merchant_settlements WHERE merchant_id = a.merchant_id
    AND source_type = 'order' AND source_id = a.order_id AND gateway = 'paystack'
    AND gateway_reference = r.capture_reference AND metadata->>'paystack_collection' = 'integration' FOR UPDATE;
  IF NOT FOUND OR s.status NOT IN ('pending','settled') OR debit > s.net_amount OR p_merchant_debit_minor > r.amount_minor
    OR s.wallet_id IS NULL THEN RAISE EXCEPTION 'merchant_adjustment_review'; END IF;
  IF s.status = 'pending' THEN
    UPDATE public.merchant_wallets SET upcoming_balance = upcoming_balance - debit, updated_at = now()
    WHERE id = s.wallet_id AND merchant_id = a.merchant_id AND upcoming_balance >= debit
    RETURNING upcoming_balance INTO wallet_balance;
  ELSE
    UPDATE public.merchant_wallets
    SET available_balance = available_balance - debit, total_earned = total_earned - debit, updated_at = now()
    WHERE id = s.wallet_id AND merchant_id = a.merchant_id AND available_balance >= debit
    RETURNING available_balance INTO wallet_balance;
    IF debit > 0 AND wallet_balance IS NOT NULL THEN
      INSERT INTO public.wallet_transactions(wallet_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status,metadata)
      VALUES (s.wallet_id,a.merchant_id,'debit',debit,wallet_balance,'refund',r.refund_transaction_id,
        'Paid order amendment refund adjustment','completed',jsonb_build_object('settlement_id',s.id,'order_id',a.order_id));
    END IF;
  END IF;
  IF wallet_balance IS NULL THEN RAISE EXCEPTION 'merchant_adjustment_review'; END IF;
  INSERT INTO private.paid_order_amendment_adjustments(refund_id,settlement_id,amount_minor,finance_reference,original_net_amount)
  VALUES (r.id,s.id,p_merchant_debit_minor,btrim(p_finance_reference),s.net_amount);
  UPDATE public.merchant_settlements SET net_amount = net_amount - debit,updated_at = now() WHERE id = s.id;
  UPDATE private.paid_order_amendments SET state = 'settled',refund_owed_minor = 0,hold_fulfillment = false WHERE id = a.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
  VALUES (a.id,'merchant_adjustment_applied',jsonb_build_object('operationId',r.id,'settlementId',s.id,'amountMinor',p_merchant_debit_minor));
  RETURN private.paid_order_amendment_summary(a.order_id);
END;
$$;

REVOKE ALL ON FUNCTION private.post_paid_order_amendment_adjustment(uuid,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apply_paid_order_amendment_adjustment(
  p_attempt uuid,p_merchant_debit_minor bigint,p_finance_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  approval private.paid_order_amendment_finance_approvals%ROWTYPE;
  order_id uuid;
  refund_amount bigint;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_finance_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a.order_id,r.amount_minor INTO order_id,refund_amount
  FROM private.paid_order_amendment_refunds r JOIN private.paid_order_amendments a ON a.id = r.amendment_id
  WHERE r.id = p_attempt AND r.state = 'processed' AND r.refund_transaction_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  IF p_merchant_debit_minor IS NULL OR p_merchant_debit_minor NOT BETWEEN 0 AND refund_amount
    OR p_finance_reference IS NULL OR length(btrim(p_finance_reference)) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'invalid_amendment_adjustment' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || order_id,0));
  INSERT INTO private.paid_order_amendment_finance_approvals(refund_id,amount_minor,finance_reference)
  VALUES (p_attempt,p_merchant_debit_minor,btrim(p_finance_reference)) ON CONFLICT (refund_id) DO NOTHING;
  SELECT * INTO STRICT approval FROM private.paid_order_amendment_finance_approvals WHERE refund_id = p_attempt;
  IF approval.amount_minor IS DISTINCT FROM p_merchant_debit_minor
    OR approval.finance_reference IS DISTINCT FROM btrim(p_finance_reference) THEN
    RAISE EXCEPTION 'idempotency_conflict';
  END IF;
  BEGIN
    RETURN private.post_paid_order_amendment_adjustment(p_attempt,approval.amount_minor,approval.finance_reference);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'merchant_adjustment_review' THEN RAISE; END IF;
    UPDATE private.paid_order_amendment_finance_approvals
      SET next_attempt_at = clock_timestamp() + interval '15 minutes' WHERE refund_id = p_attempt;
    RETURN jsonb_build_object('outcome','review','holdFulfillment',true);
  END;
END;
$$;

CREATE FUNCTION public.retry_due_paid_order_amendment_adjustments(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  approval private.paid_order_amendment_finance_approvals%ROWTYPE;
  applied integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_finance_worker_required' USING ERRCODE = '42501';
  END IF;
  FOR approval IN SELECT f.* FROM private.paid_order_amendment_finance_approvals f
    WHERE f.next_attempt_at <= now() AND NOT EXISTS (
      SELECT 1 FROM private.paid_order_amendment_adjustments a WHERE a.refund_id = f.refund_id
    ) ORDER BY f.refund_id LIMIT greatest(0,least(p_limit,10))
  LOOP
    BEGIN
      IF public.apply_paid_order_amendment_adjustment(approval.refund_id,approval.amount_minor,approval.finance_reference)
        ->>'state' = 'settled' THEN applied := applied + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.paid_order_amendment_finance_approvals
        SET next_attempt_at = clock_timestamp() + interval '15 minutes' WHERE refund_id = approval.refund_id;
    END;
  END LOOP;
  RETURN applied;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_due_paid_order_amendment_adjustments(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_due_paid_order_amendment_adjustments(integer) TO service_role;

REVOKE ALL ON FUNCTION public.list_due_paid_order_amendment_refunds(integer),
  public.claim_paid_order_amendment_refund(uuid), public.find_paid_order_amendment_refund(text,text,text),
  public.record_paid_order_amendment_refund(text,jsonb),public.apply_paid_order_amendment_adjustment(uuid,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_due_paid_order_amendment_refunds(integer),
  public.claim_paid_order_amendment_refund(uuid), public.find_paid_order_amendment_refund(text,text,text),
  public.record_paid_order_amendment_refund(text,jsonb),public.apply_paid_order_amendment_adjustment(uuid,bigint,text)
  TO service_role;

CREATE FUNCTION private.apply_paid_order_refund_operator_action(a private.paid_order_amendments,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  prior private.paid_order_amendment_refunds%ROWTYPE;
  attempt uuid;
BEGIN
  SELECT * INTO prior FROM private.paid_order_amendment_refunds
    WHERE id = (p_payload->>'operationId')::uuid AND amendment_id = a.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_not_found' USING ERRCODE = 'P0002'; END IF;
  CASE p_payload->>'action'
    WHEN 'refresh_refund_status' THEN
      IF prior.state NOT IN ('uncertain','pending','processing','needs_attention') THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
      UPDATE private.paid_order_amendment_refunds SET next_lookup_at = now() WHERE id = prior.id;
      attempt := prior.id;
    WHEN 'retry_failed_refund' THEN
      IF a.state <> 'awaiting_refund' OR prior.state <> 'failed' OR prior.provider_refund_id IS NULL
        OR EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds r
          WHERE r.amendment_id = a.id AND r.id <> prior.id AND r.created_at >= prior.created_at) THEN
        RAISE EXCEPTION 'refund_evidence_required';
      END IF;
      attempt := private.queue_paid_order_amendment_refund(a,prior.payment_id);
      IF attempt IS NULL THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
    WHEN 'retry_merchant_adjustment' THEN
      IF prior.state <> 'processed' THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
      IF EXISTS (SELECT 1 FROM private.paid_order_amendment_adjustments WHERE refund_id = prior.id) THEN
        RETURN private.paid_order_amendment_summary(a.order_id);
      END IF;
      UPDATE private.paid_order_amendment_finance_approvals SET next_attempt_at = now() WHERE refund_id = prior.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'merchant_adjustment_review'; END IF;
      attempt := prior.id;
    ELSE RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END CASE;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),p_payload->>'action',jsonb_build_object('operationId',attempt));
  RETURN jsonb_build_object('operationId',attempt);
END;
$$;
REVOKE ALL ON FUNCTION private.apply_paid_order_refund_operator_action(private.paid_order_amendments,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
