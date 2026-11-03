-- Enable only the captured iPhone eSIM and part-number diagnostics at NGN700 each.
-- Follow-on to the immutable authenticated boundary; all proof, ownership,
-- wallet, failure-recovery and privilege rules remain byte-identical.
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
    -- Pin the existing public retail prices; provider prices cannot set money.
    expected_amount := CASE args->>'tier'
      WHEN 'esimCompatibility' THEN 700
      WHEN 'applePartNumber' THEN 700
      WHEN 'full' THEN 1500 WHEN 'activation' THEN 700 WHEN 'blacklist' THEN 700
      WHEN 'blacklistPro' THEN 2000 WHEN 'carrier' THEN 1000 WHEN 'simLock' THEN 500
      WHEN 'icloud' THEN 300 WHEN 'icloudPro' THEN 3500 WHEN 'icloudCleanLost' THEN 500
      WHEN 'carrierFmi' THEN 1300 WHEN 'basic' THEN 300 WHEN 'appleBasic' THEN 800
      WHEN 'serialInfo' THEN 200 WHEN 'macIcloud' THEN 3300 WHEN 'soldByCountry' THEN 29400
      WHEN 'gsxPremium' THEN 32700 WHEN 'gsxRepairs' THEN 19600 WHEN 'repairEligibility' THEN 2300
      WHEN 'replacementHistory' THEN 11500 WHEN 'demoUnit' THEN 3300 WHEN 'mdm' THEN 5000
      WHEN 'samsung' THEN 1000 WHEN 'samsungPro' THEN 1500 WHEN 'knoxGuard' THEN 5000
      WHEN 'miLock' THEN 1500 WHEN 'miLostPro' THEN 8000 WHEN 'pixel' THEN 2000
      WHEN 'oppoRealme' THEN 3300 WHEN 'transsion' THEN 500 ELSE NULL END;
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
        WHERE t.source_type='imei_wallet_payment' AND t.source_id=lookup_id AND t.type='redemption') THEN
        RAISE EXCEPTION 'imei_access_charged_lookup_delete_denied' USING ERRCODE='42501';
      END IF;
      DELETE FROM public.imei_lookups WHERE id=lookup_id;
      RETURN jsonb_build_object('id',lookup_id);
    WHEN 'cache' THEN
      patch := args->'patch';
      -- A transport failure can hide a committed debit. Never finalize that
      -- charged lookup as an uncharged failure; recovery reads durable state.
      IF patch->>'status' IN ('failed_error','wallet_rejected') AND EXISTS
        (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.type='redemption' AND t.source_id=lookup_id
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id) THEN
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
      IF patch->>'status'='completed' AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions t
          WHERE t.source_type='imei_wallet_payment' AND t.source_id=lookup_id AND t.type='redemption'
            AND t.customer_id=customer_id AND t.merchant_id=merchant_id AND t.amount=lookup_row.amount_ngn) THEN
        RAISE EXCEPTION 'imei_access_completion_without_debit' USING ERRCODE='42501';
      END IF;
      IF patch->>'status' IN ('refunded_error','refunded_not_found') AND NOT EXISTS
        (SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_type='imei_wallet_refund'
          AND t.source_id=lookup_id AND t.customer_id=customer_id AND t.merchant_id=merchant_id
          AND t.amount=lookup_row.amount_ngn) THEN
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
