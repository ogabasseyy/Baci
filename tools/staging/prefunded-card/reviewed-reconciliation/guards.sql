CREATE FUNCTION pg_temp.reviewed_preflight() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $preflight$
DECLARE approval jsonb; target oid; intent prefunded_card.checkout_intents%ROWTYPE;
DECLARE operation prefunded_card.operations%ROWTYPE; routine jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user NOT IN ('postgres','prefunded_authorizer')
    OR current_database()<>'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'reviewed owner context refused' USING ERRCODE='42501';
  END IF;
  SELECT value INTO STRICT approval FROM pg_temp.reviewed_approval;
  IF (approval#>>'{proof,verifiedAt}')::timestamptz>clock_timestamp()
    OR clock_timestamp()-(approval#>>'{proof,verifiedAt}')::timestamptz>interval '60 seconds'
    OR approval#>>'{scope,expiresAt}'<>'2026-10-06T15:59:10Z'
    OR approval#>'{proof,independentlyVerified}' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'reviewed proof expired' USING ERRCODE='42501';
  END IF;
  target:=to_regprocedure('prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)');
  SELECT jsonb_build_object('oid',entry.oid::bigint,'ownerOid',proowner::bigint,'owner',pg_get_userbyid(proowner),
    'acl',proacl,'securityDefiner',prosecdef,'configuration',proconfig,'language',language.lanname)
    INTO routine FROM pg_proc entry JOIN pg_language language ON language.oid=entry.prolang WHERE entry.oid=target;
  IF routine IS DISTINCT FROM approval#>'{preflight,routine}'
    OR encode(sha256(convert_to(pg_get_functiondef(target),'UTF8')),'hex') IS DISTINCT FROM
      'e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f'
    OR pg_temp.reviewed_metadata() IS DISTINCT FROM approval#>>'{preflight,permanentMetadataSha256}'
    OR pg_temp.reviewed_state() IS DISTINCT FROM approval#>>'{preflight,protectedRowsSha256}' THEN
    RAISE EXCEPTION 'reviewed permanent baseline changed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT intent FROM prefunded_card.checkout_intents
    WHERE id='ff561046-58e7-428d-9163-f6e60b0dab65' FOR UPDATE;
  SELECT * INTO STRICT operation FROM prefunded_card.operations WHERE id=intent.operation_id FOR UPDATE;
  IF encode(sha256(convert_to(to_jsonb(intent)::text,'UTF8')),'hex') IS DISTINCT FROM approval#>>'{preflight,intentSha256}'
    OR encode(sha256(convert_to(to_jsonb(operation)::text,'UTF8')),'hex') IS DISTINCT FROM approval#>>'{preflight,operationSha256}'
    OR intent.goal_id<>'9f01153c-1589-4dde-b9aa-8f644a846832' OR intent.operation_id<>intent.id
    OR intent.amount_kobo<>10000 OR operation.amount_kobo<>10000
    OR intent.phase<>'reconciliation_required' OR intent.verified_collection IS NOT NULL
    OR intent.initialization_token IS NOT NULL OR intent.initialization_lease_expires_at IS NOT NULL
    OR intent.reconciliation_flagged_at IS NULL
    OR intent.reconciliation_flagged_at>=(approval#>>'{proof,paidAt}')::timestamptz
    OR operation.checkout_retired OR operation.collection_status<>'pending'
    OR operation.collection_provider_transaction_id IS NOT NULL OR operation.transfer_status<>'not_started'
    OR operation.transfer_attempted_at IS NOT NULL OR operation.transfer_provider_transaction_id IS NOT NULL
    OR operation.projection_status<>'unapplied'
    OR (operation.verification_token IS NULL) IS DISTINCT FROM (operation.verification_lease_expires_at IS NULL)
    OR operation.verification_lease_expires_at>clock_timestamp()
    OR EXISTS(SELECT 1 FROM prefunded_card.checkout_retirements WHERE intent_id=intent.id OR operation_id=operation.id)
    OR EXISTS(SELECT 1 FROM prefunded_card.dispatch_queue WHERE operation_id=operation.id
      AND (claim_token IS NOT NULL OR lease_expires_at IS NOT NULL))
    OR EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=operation.id)
    OR EXISTS(SELECT 1 FROM prefunded_card.bank_projections WHERE operation_id=operation.id)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE id=operation.id)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions WHERE idempotency_key='pvb-card:'||operation.id)
    OR EXISTS(SELECT 1 FROM prefunded_card.authorization_bindings
      WHERE transaction_id=operation.id OR saved_method_id=intent.prepared_saved_method_id
        OR provider_transaction_id=approval#>>'{collection,providerTransactionId}')
    OR EXISTS(SELECT 1 FROM public.customer_saved_payment_methods WHERE id=intent.prepared_saved_method_id
      OR customer_id=intent.customer_id AND provider='paystack'
        AND authorization_signature=approval#>>'{collection,authorization,signature}') THEN
    RAISE EXCEPTION 'reviewed exact unpaid database state refused' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE id=intent.goal_id
      AND merchant_id=intent.merchant_id AND customer_id=intent.customer_id AND current_amount=0)
    OR NOT EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'
      AND merchant_id=intent.merchant_id AND customer_id=intent.customer_id AND current_amount=100)
    OR (SELECT count(*) FROM prefunded_card.checkout_intents old_intent JOIN prefunded_card.operations old_operation
      ON old_operation.id=old_intent.operation_id JOIN prefunded_card.checkout_retirements retirement
      ON retirement.intent_id=old_intent.id AND retirement.operation_id=old_operation.id
      WHERE old_intent.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
        AND old_intent.phase='retired_unconfirmed' AND old_operation.checkout_retired)<>1
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings WHERE id=intent.treasury_binding_id
      AND enabled AND verified_available_kobo=10000 AND reserved_kobo=10000 AND consumed_kobo=0)
    OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=intent.customer_id
      AND merchant_id=intent.merchant_id AND user_id=intent.actor_id AND lower(btrim(email))=intent.email)
    OR intent.email IS DISTINCT FROM approval#>>'{collection,authorization,email}' THEN
    RAISE EXCEPTION 'reviewed principal treasury or ownership refused' USING ERRCODE='42501';
  END IF;
END $preflight$;

CREATE FUNCTION pg_temp.reviewed_approval_guard(p_scope jsonb,p_selection jsonb,p_collection jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $approval$
DECLARE approval jsonb;
BEGIN
  IF session_user<>'prefunded_authorizer' THEN
    RAISE EXCEPTION 'reviewed authorizer refused' USING ERRCODE='42501';
  END IF;
  SELECT value INTO STRICT approval FROM pg_temp.reviewed_approval;
  IF p_scope IS DISTINCT FROM approval->'scope' OR p_selection IS DISTINCT FROM approval->'selection'
    OR p_collection IS DISTINCT FROM approval->'collection'
    OR encode(sha256(convert_to(p_scope::text,'UTF8')),'hex') IS DISTINCT FROM approval#>>'{parameterDigests,scope}'
    OR encode(sha256(convert_to(p_selection::text,'UTF8')),'hex') IS DISTINCT FROM approval#>>'{parameterDigests,selection}'
    OR encode(sha256(convert_to(p_collection::text,'UTF8')),'hex') IS DISTINCT FROM approval#>>'{parameterDigests,collection}' THEN
    RAISE EXCEPTION 'reviewed bound parameters refused' USING ERRCODE='42501';
  END IF;
  PERFORM pg_temp.reviewed_preflight();
END $approval$;
REVOKE ALL ON FUNCTION pg_temp.reviewed_preflight(),pg_temp.reviewed_approval_guard(jsonb,jsonb,jsonb) FROM PUBLIC;
