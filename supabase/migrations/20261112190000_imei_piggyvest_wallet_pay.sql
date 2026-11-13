-- IMEI checks paid from the PiggyVest main wallet (dark; PR 2 of "pay from
-- your PiggyVest wallet", on top of 20261112161500_piggyvest_wallet_pay).
--
-- imei_lookup_access is redefined from 20261030181744 (latest) with exactly
-- four additions, all in the cache / delete_pending money guards. Everything
-- else (prices, signing, ownership, Petrock operations, grants) is unchanged:
--   * completed      : a legacy store-credit debit, OR a confirmed PiggyVest
--                      payment whose delivery is claimed ('delivering').
--   * refunded_*     : a legacy refund credit, OR a PiggyVest refund owed or
--                      sent by the wallet pay ledger ('refund_owed'). The
--                      wallet pay ledger sends that refund exactly once.
--   * failed_error / wallet_rejected : refused while a PiggyVest payment holds
--                      or is moving the customer's money ('charged',
--                      'delivering' or 'refund_owed'), like a legacy debit:
--                      a refunded check must stay refunded_*.
--   * delete_pending : refused once any PiggyVest payment exists.
-- It also adds imei_wallet_payment_delivered, which the wallet pay drain asks
-- before refunding an uncollected payment (a saved result is fulfilled).
-- A PiggyVest payment counts only for purpose imei_check, purchase_ref = the
-- lookup id, the same customer and merchant (through the onboarding intent),
-- and exactly the lookup's price in kobo. Petrock (asynchronous) lookups are
-- not offered PiggyVest payment yet; their debit lives in deeper functions.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- The PiggyVest payment state of one IMEI lookup, for the money guards above.
-- NULL when no PiggyVest payment of this lookup exists (or only issued /
-- released attempts that never moved money).
CREATE FUNCTION piggyvest_primary.imei_wallet_payment_state(
  p_lookup_id uuid, p_customer_id uuid, p_merchant_id uuid, p_amount_ngn numeric)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Judged on the NEWEST attempt that moved or holds money (issued and
  -- released attempts never did), so an older refunded attempt can not
  -- outrank a newer payment that is being delivered.
  SELECT CASE
    WHEN latest.fulfilment IN ('refund_owed', 'refunded') THEN 'refund_owed'
    WHEN latest.state = 'confirmed' AND latest.fulfilment = 'claimed' THEN 'delivering'
    WHEN latest.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review') THEN 'charged'
    ELSE NULL END
  FROM (
    SELECT payment.state, payment.fulfilment
      FROM piggyvest_primary.wallet_payments AS payment
      JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
     WHERE payment.purpose = 'imei_check'
       AND payment.purchase_ref = p_lookup_id::text
       AND intent.customer_id = p_customer_id
       AND intent.merchant_id = p_merchant_id
       AND payment.amount_kobo = (p_amount_ngn * 100)::bigint
       AND p_amount_ngn * 100 = trunc(p_amount_ngn * 100)
       AND payment.state NOT IN ('issued', 'released')
     -- Ties broken by issue time, then id, so the choice is deterministic.
     ORDER BY COALESCE(payment.reserved_at, payment.issued_at) DESC,
              payment.issued_at DESC, payment.id DESC
     LIMIT 1
  ) AS latest;
$$;
REVOKE ALL ON FUNCTION piggyvest_primary.imei_wallet_payment_state(uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- For the wallet pay drain (authorizer login, worker authority): whether the
-- IMEI check a confirmed payment bought was already delivered (its lookup is
-- completed for the same customer, merchant and price). A delivery that saved
-- the result but lost the fulfilment write must be recorded as fulfilled,
-- never refunded.
CREATE FUNCTION piggyvest_primary.imei_wallet_payment_delivered(
  integration_id uuid, environment text, operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    imei_wallet_payment_delivered.integration_id, imei_wallet_payment_delivered.environment);
  RETURN EXISTS (
    SELECT 1
      FROM piggyvest_primary.wallet_payments AS payment
      JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = payment.intent_id
      JOIN public.imei_lookups AS lookup ON lookup.id::text = payment.purchase_ref
     WHERE payment.id = imei_wallet_payment_delivered.operation_id
       AND payment.integration_id = imei_wallet_payment_delivered.integration_id
       AND payment.purpose = 'imei_check'
       AND payment.state = 'confirmed'
       AND payment.fulfilment = 'claimed'
       AND lookup.status = 'completed'
       AND lookup.customer_id = intent.customer_id
       AND lookup.merchant_id = intent.merchant_id
       AND lookup.amount_ngn * 100 = trunc(lookup.amount_ngn * 100)
       AND payment.amount_kobo = (lookup.amount_ngn * 100)::bigint);
END;
$$;
REVOKE ALL ON FUNCTION piggyvest_primary.imei_wallet_payment_delivered(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.imei_wallet_payment_delivered(uuid, text, uuid)
  TO piggyvest_primary_authorizer;

-- A delivered IMEI check is never refunded (Codex P1): once its lookup is
-- completed, a claimed payment can not move to refund_owed. Saving a
-- completed result locks the lookup's payments first (imei_lookup_access
-- 'cache' below), so the two are serialised: whichever commits first wins,
-- and the other is refused (a refund already owed blocks the completion
-- through imei_wallet_payment_state; a saved result blocks the refund here).
CREATE FUNCTION piggyvest_primary.refuse_refund_of_delivered_imei_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.imei_lookups AS lookup
              WHERE lookup.id::text = NEW.purchase_ref
                AND lookup.status = 'completed') THEN
    RAISE EXCEPTION 'imei_wallet_payment_already_delivered' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION piggyvest_primary.refuse_refund_of_delivered_imei_check()
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;
CREATE TRIGGER wallet_payments_refuse_refund_of_delivered_imei_check
  BEFORE UPDATE OF fulfilment ON piggyvest_primary.wallet_payments
  FOR EACH ROW
  WHEN (OLD.purpose = 'imei_check' AND OLD.fulfilment = 'claimed'
        AND NEW.fulfilment = 'refund_owed')
  EXECUTE FUNCTION piggyvest_primary.refuse_refund_of_delivered_imei_check();

CREATE OR REPLACE FUNCTION public.imei_lookup_access(p_payload text, p_signature text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_variable
DECLARE
  proof jsonb := private.assert_imei_access(p_payload,p_signature);
  args jsonb := proof->'args'; operation text := proof->>'operation';
  customer_id uuid := (proof->>'customer')::uuid;
  merchant_id uuid := (proof->>'merchant')::uuid;
  lookup_id uuid; lookup_row public.imei_lookups%ROWTYPE;
  result jsonb; expected_amount numeric; patch jsonb;
BEGIN
  IF operation = 'read_snapshot' THEN
    SELECT jsonb_build_object('product_id',p.product_id,'price_usd',p.price_usd,
      'currency',p.currency,'order_field_name',p.order_field_name,'active',p.active,'synced_at',p.synced_at)
      INTO result FROM public.imei_provider_products p
      WHERE p.provider='petrock' AND p.product_id=args->>'product_id';
    RETURN result;
  END IF;
  IF operation IN ('read_replay','read_status') THEN
    SELECT jsonb_build_object('id',l.id,'customer_id',l.customer_id,'merchant_id',l.merchant_id,
      'tier',l.tier,'imei_hash',l.imei_hash,'device_category',l.device_category,'amount_ngn',l.amount_ngn,
      'status',l.status,'cached_response',l.cached_response,'cached_status',l.cached_status)
      INTO result FROM public.imei_lookups l
      WHERE l.customer_id=customer_id AND l.merchant_id=merchant_id
        AND ((operation='read_replay' AND l.idempotency_key=(args->>'idempotency_key')::uuid)
          OR (operation='read_status' AND l.id=(args->>'lookup_id')::uuid));
    RETURN result;
  END IF;
  IF operation='insert_pending' THEN
    -- Pin approved fixed retail prices; provider prices cannot set money.
    expected_amount := CASE args->>'tier'
      WHEN 'esimCompatibility' THEN 400
      WHEN 'applePartNumber' THEN 700
      WHEN 'full' THEN 1000 WHEN 'activation' THEN 400 WHEN 'blacklist' THEN 700
      WHEN 'blacklistPro' THEN 1200 WHEN 'carrier' THEN 600 WHEN 'simLock' THEN 500
      WHEN 'icloud' THEN 300 WHEN 'icloudPro' THEN 2100 WHEN 'icloudCleanLost' THEN 300
      WHEN 'carrierFmi' THEN 800 WHEN 'basic' THEN 300 WHEN 'appleBasic' THEN 500
      WHEN 'serialInfo' THEN 200 WHEN 'macIcloud' THEN 1900 WHEN 'soldByCountry' THEN 5700
      WHEN 'gsxPremium' THEN 6300 WHEN 'gsxRepairs' THEN 3800 WHEN 'repairEligibility' THEN 1400
      WHEN 'replacementHistory' THEN 6700 WHEN 'demoUnit' THEN 1900 WHEN 'mdm' THEN 2900
      WHEN 'samsung' THEN 600 WHEN 'samsungPro' THEN 1000 WHEN 'knoxGuard' THEN 2900
      WHEN 'miLock' THEN 1000 WHEN 'miLostPro' THEN 4800 WHEN 'pixel' THEN 1200
      WHEN 'oppoRealme' THEN 1900 WHEN 'transsion' THEN 300 ELSE NULL END;
    IF expected_amount IS NULL OR (args->>'amount_ngn')::numeric IS DISTINCT FROM expected_amount
      OR args->>'customer_id' IS DISTINCT FROM customer_id::text
      OR args->>'merchant_id' IS DISTINCT FROM merchant_id::text
      OR args->>'status' IS DISTINCT FROM 'pending'
      OR coalesce(args->>'imei_hash','') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'imei_access_insert_invalid' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.imei_lookups(customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,device_category)
      VALUES(customer_id,merchant_id,args->>'tier',args->>'imei_hash',(args->>'idempotency_key')::uuid,
        expected_amount,'pending',args->>'device_category') RETURNING id INTO lookup_id;
    RETURN jsonb_build_object('id',lookup_id);
  END IF;
  lookup_id := coalesce(args->>'p_lookup_id',args->>'lookup_id')::uuid;
  -- Consistent advisory lock order with payment functions, then the row lock.
  PERFORM pg_advisory_xact_lock(('x'||substr(md5(lookup_id::text),1,16))::bit(64)::bigint);
  SELECT l.* INTO lookup_row FROM public.imei_lookups l
    WHERE l.id=lookup_id AND l.customer_id=customer_id AND l.merchant_id=merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'imei_access_lookup_denied' USING ERRCODE='42501'; END IF;
  IF args ? 'p_customer_id' AND args->>'p_customer_id' IS DISTINCT FROM customer_id::text
    OR args ? 'p_merchant_id' AND args->>'p_merchant_id' IS DISTINCT FROM merchant_id::text
    OR args ? 'p_amount' AND (args->>'p_amount')::numeric IS DISTINCT FROM lookup_row.amount_ngn THEN
    RAISE EXCEPTION 'imei_access_identity_or_amount_mismatch' USING ERRCODE='42501';
  END IF;
  CASE operation
    WHEN 'cancel_unsubmitted_petrock_imei_lookup' THEN
      -- Only the server-attested recovery path before provider.submit may use
      -- this operation. Pollers never submit, so cancellation can fence their
      -- lease without risking a supplier order; order-bearing rows are refused.
      IF lookup_row.provider IS DISTINCT FROM 'petrock' THEN
        RAISE EXCEPTION 'imei_access_cancellation_provider_invalid' USING ERRCODE='42501';
      END IF;
      IF lookup_row.status='refunded_error' AND lookup_row.provider_status='submission_not_started'
        AND EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_refund' AND t.type='refund' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn) THEN
        RETURN 'true'::jsonb;
      END IF;
      IF lookup_row.provider_order_id IS NOT NULL
        OR lookup_row.status NOT IN ('provider_submitting','submission_unknown') THEN
        RETURN 'false'::jsonb;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.type='redemption' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn) THEN
        RAISE EXCEPTION 'imei_access_cancellation_without_debit' USING ERRCODE='42501';
      END IF;
      PERFORM public.refund_imei_wallet_payment(p_customer_id=>customer_id,p_merchant_id=>merchant_id,
        p_amount=>lookup_row.amount_ngn,p_lookup_id=>lookup_id,
        p_description=>'Petrock IMEI submission did not start - payment refunded to wallet');
      UPDATE public.imei_lookups SET status='refunded_error',provider_status='submission_not_started',
        cached_status=502,cached_response=jsonb_build_object('code','PETROCK_NOT_SUBMITTED',
          'error','Lookup could not start; your wallet was refunded.','success',false,'status','error','lookupId',lookup_id),
        identifier_ciphertext=NULL,feedback_token_hash=NULL,next_poll_at=NULL,
        reconcile_lease_token=NULL,reconcile_lease_until=NULL
        WHERE id=lookup_id;
      RETURN 'true'::jsonb;
    WHEN 'read_payment_state' THEN
      RETURN jsonb_build_object(
        'debited',EXISTS(SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.type='redemption' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn),
        'refunded',EXISTS(SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_refund' AND t.type='refund' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn));
    WHEN 'delete_pending' THEN
      IF lookup_row.status <> 'pending' OR EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
        WHERE t.source_type='imei_wallet_payment' AND t.source_id=lookup_id AND t.type='redemption')
        -- Any PiggyVest payment ever issued for it (issued or released too):
        -- an operation already handed out must keep its lookup.
        OR EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments AS payment
          WHERE payment.purpose='imei_check' AND payment.purchase_ref=lookup_id::text) THEN
        RAISE EXCEPTION 'imei_access_charged_lookup_delete_denied' USING ERRCODE='42501';
      END IF;
      DELETE FROM public.imei_lookups WHERE id=lookup_id;
      RETURN jsonb_build_object('id',lookup_id);
    WHEN 'cache' THEN
      patch := args->'patch';
      -- A transport failure can hide a committed debit. Never finalize that
      -- charged lookup as an uncharged failure; recovery reads durable state.
      IF patch->>'status' IN ('failed_error','wallet_rejected') AND (EXISTS
        (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.type='redemption' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id)
        OR piggyvest_primary.imei_wallet_payment_state(lookup_id,customer_id,merchant_id,lookup_row.amount_ngn)
          IN ('charged','delivering','refund_owed')) THEN
        RAISE EXCEPTION 'imei_access_charged_lookup_failure_denied' USING ERRCODE='42501';
      END IF;
      IF lookup_row.status IS NOT DISTINCT FROM patch->>'status'
        AND lookup_row.cached_response IS NOT DISTINCT FROM patch->'cached_response'
        AND lookup_row.cached_status IS NOT DISTINCT FROM (patch->>'cached_status')::integer THEN
        RETURN jsonb_build_object('id',lookup_id);
      END IF;
      IF lookup_row.status NOT IN ('pending','refund_pending')
        OR patch->>'status' IS NULL OR patch->>'cached_status' IS NULL
        OR patch->>'status' NOT IN ('completed','failed_error','wallet_rejected','refunded_error','refunded_not_found','refund_pending')
        OR (patch->>'cached_status')::integer NOT BETWEEN 200 AND 599
        OR jsonb_typeof(patch->'cached_response') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'imei_access_cache_state_invalid' USING ERRCODE='42501';
      END IF;
      -- Serialised with a refund of the same payment (see the trigger above).
      IF patch->>'status'='completed' THEN
        PERFORM 1 FROM piggyvest_primary.wallet_payments AS payment
          WHERE payment.purpose='imei_check' AND payment.purchase_ref=lookup_id::text
          FOR UPDATE;
      END IF;
      IF patch->>'status'='completed' AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.source_id=lookup_id AND t.type='redemption'
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn)
        AND piggyvest_primary.imei_wallet_payment_state(lookup_id,customer_id,merchant_id,lookup_row.amount_ngn)
          IS DISTINCT FROM 'delivering' THEN
        RAISE EXCEPTION 'imei_access_completion_without_debit' USING ERRCODE='42501';
      END IF;
      IF patch->>'status' IN ('refunded_error','refunded_not_found') AND NOT EXISTS
        (SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_type='imei_wallet_refund'
          AND t.source_id=lookup_id AND t.customer_id=customer_id AND t.merchant_id=merchant_id
          AND t.amount=lookup_row.amount_ngn)
        AND piggyvest_primary.imei_wallet_payment_state(lookup_id,customer_id,merchant_id,lookup_row.amount_ngn)
          IS DISTINCT FROM 'refund_owed' THEN
        RAISE EXCEPTION 'imei_access_refund_without_credit' USING ERRCODE='42501';
      END IF;
      UPDATE public.imei_lookups SET status=patch->>'status',cached_response=patch->'cached_response',
        cached_status=(patch->>'cached_status')::integer,response_hash=patch->>'response_hash',sickw_status=patch->>'sickw_status'
        WHERE id=lookup_id;
      RETURN jsonb_build_object('id',lookup_id);
    WHEN 'redeem_imei_wallet_payment' THEN
      IF lookup_row.status <> 'pending' THEN
        RAISE EXCEPTION 'imei_access_lookup_not_pending' USING ERRCODE='42501';
      END IF;
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result
        FROM public.redeem_imei_wallet_payment(p_customer_id=>customer_id,p_merchant_id=>merchant_id,
          p_amount=>lookup_row.amount_ngn,p_lookup_id=>lookup_id,p_description=>args->>'p_description') r;
    WHEN 'refund_imei_wallet_payment' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result
        FROM public.refund_imei_wallet_payment(p_customer_id=>customer_id,p_merchant_id=>merchant_id,
          p_amount=>lookup_row.amount_ngn,p_lookup_id=>lookup_id,p_description=>args->>'p_description') r;
    WHEN 'redeem_imei_wallet_and_begin_provider_submission' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result
        FROM public.redeem_imei_wallet_and_begin_provider_submission(p_customer_id=>customer_id,p_merchant_id=>merchant_id,
          p_amount=>lookup_row.amount_ngn,p_lookup_id=>lookup_id,p_provider=>args->>'p_provider',
          p_reference_id=>args->>'p_reference_id',p_feedback_token_hash=>args->>'p_feedback_token_hash',
          p_identifier_ciphertext=>args->>'p_identifier_ciphertext',p_cost_usd=>(args->>'p_cost_usd')::numeric,
          p_provider_attempt_started_at=>(args->>'p_provider_attempt_started_at')::timestamptz,
          p_device_category=>args->>'p_device_category',p_description=>args->>'p_description') r;
    WHEN 'record_petrock_imei_submission' THEN
      result := to_jsonb(public.record_petrock_imei_submission(p_lookup_id=>lookup_id,p_order_id=>args->>'p_order_id',
        p_provider_status=>args->>'p_provider_status',p_next_poll_at=>(args->>'p_next_poll_at')::timestamptz,
        p_lease_token=>(args->>'p_lease_token')::uuid));
    WHEN 'mark_petrock_imei_submission_unknown' THEN
      result := to_jsonb(public.mark_petrock_imei_submission_unknown(p_lookup_id=>lookup_id,p_provider_status=>args->>'p_provider_status',
        p_lease_token=>(args->>'p_lease_token')::uuid,p_order_id=>args->>'p_order_id'));
    WHEN 'finalize_petrock_imei_lookup' THEN
      result := to_jsonb(public.finalize_petrock_imei_lookup(p_lookup_id=>lookup_id,p_terminal_status=>args->>'p_terminal_status',
        p_cached_response=>args->'p_cached_response',p_cached_status=>(args->>'p_cached_status')::integer,
        p_provider_status=>args->>'p_provider_status',p_response_hash=>args->>'p_response_hash',
        p_lease_token=>(args->>'p_lease_token')::uuid));
    WHEN 'claim_petrock_imei_lookup_poll' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result
        FROM public.claim_petrock_imei_lookup_poll(p_lookup_id=>lookup_id,p_customer_id=>customer_id,
          p_merchant_id=>merchant_id,p_lease_token=>(args->>'p_lease_token')::uuid,p_lease_seconds=>30) r;
    WHEN 'reschedule_petrock_imei_lookup_poll' THEN
      result := to_jsonb(public.reschedule_petrock_imei_lookup_poll(p_lookup_id=>lookup_id,p_lease_token=>(args->>'p_lease_token')::uuid,
        p_provider_status=>args->>'p_provider_status',p_next_poll_at=>(args->>'p_next_poll_at')::timestamptz));
    ELSE RAISE EXCEPTION 'imei_access_operation_denied' USING ERRCODE='42501';
  END CASE;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.imei_lookup_access(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.imei_lookup_access(text,text) TO authenticated;
-- Whether this customer's wallet flow ever issued a payment for one purchase
-- (dead attempts included). The IMEI start uses it to tell a lookup the
-- wallet flow created (its issued attempt expired, so it may be re-issued)
-- from one a store-credit request owns (never paid from the wallet).
CREATE FUNCTION piggyvest_primary.wallet_payment_attempted(scope jsonb, request jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
BEGIN
  IF request IS NULL OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) <> 2
    OR request ->> 'purpose' NOT IN ('imei_check', 'vtu')
    OR COALESCE(request ->> 'purchaseRef', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid wallet payment request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  RETURN EXISTS (
    SELECT 1 FROM piggyvest_primary.wallet_payments AS payment
     WHERE payment.integration_id = (scope ->> 'integrationId')::uuid
       AND payment.intent_id = v_intent_id
       AND payment.purpose = request ->> 'purpose'
       AND payment.purchase_ref = request ->> 'purchaseRef');
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.wallet_payment_attempted(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.wallet_payment_attempted(jsonb, jsonb)
  TO piggyvest_primary_authorizer;

COMMIT;
