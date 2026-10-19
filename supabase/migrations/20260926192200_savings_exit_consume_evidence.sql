BEGIN;
CREATE FUNCTION piggyvest_savings_exit_execution.consume_evidence(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid, p_operation uuid, p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE saved piggyvest_savings_exit_execution.operations%ROWTYPE;
  evidence piggyvest_savings_exit_execution.provider_evidence%ROWTYPE;
  authority piggyvest_savings_exit_execution.accounting_authorities%ROWTYPE;
  queued piggyvest_savings_exit_execution.projection_queue%ROWTYPE;
  quote piggyvest_purchase_preparation.quotes%ROWTYPE;
  purchase piggyvest_purchase_preparation.intents%ROWTYPE;
  target_order public.orders%ROWTYPE;
  amount bigint; receipt_finality jsonb; result jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' OR inet_client_addr() IS NOT NULL
    OR current_database() <> 'piggyvest_local' OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'exit accounting caller denied' USING ERRCODE = '42501';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration,p_merchant,p_customer,p_goal,p_business);
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer
    AND merchant_id = p_merchant AND user_id = p_actor) THEN
    RAISE EXCEPTION 'exit accounting actor denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO saved FROM piggyvest_savings_exit_execution.operations WHERE operation_id = p_operation FOR UPDATE;
  IF NOT FOUND OR saved.integration_id IS DISTINCT FROM p_integration OR saved.merchant_id IS DISTINCT FROM p_merchant
    OR saved.customer_id IS DISTINCT FROM p_customer OR saved.goal_id IS DISTINCT FROM p_goal
    OR saved.actor_id IS DISTINCT FROM p_actor OR saved.action IS DISTINCT FROM p_action THEN
    RAISE EXCEPTION 'exit accounting scope denied' USING ERRCODE = '42501';
  END IF;
  result := jsonb_build_object('state','pending','operationId',p_operation);
  SELECT * INTO evidence FROM piggyvest_savings_exit_execution.provider_evidence WHERE operation_id = p_operation;
  IF NOT FOUND OR evidence.created_xid = pg_current_xact_id() THEN RETURN result; END IF;
  IF saved.state NOT IN ('verify','pending_projection') THEN
    RAISE EXCEPTION 'exit accounting terminal conflict' USING ERRCODE = '23514';
  END IF;
  IF evidence.integration_id <> saved.integration_id OR evidence.receipt->>'reference' <> p_operation::text
    OR evidence.receipt->>'businessId' <> p_business OR evidence.receipt->>'currency' <> 'NGN'
    OR evidence.receipt->>'sourceWalletId' <> saved.transfer->>'sourceWalletId'
    OR evidence.receipt->>'destinationWalletId' <> saved.transfer->>'destinationWalletId'
    OR (evidence.receipt->>'amountKobo')::numeric <> (saved.transfer->>'amountKobo')::numeric THEN
    RAISE EXCEPTION 'exit accounting evidence mismatch' USING ERRCODE = '23514';
  END IF;
  receipt_finality := jsonb_build_object('evidenceId',evidence.evidence_id);
  IF saved.state = 'verify' THEN
    INSERT INTO piggyvest_savings_exit_execution.projection_queue
      (projection_id,operation_id,projection_kind,state,authority_snapshot,transfer,finality)
      VALUES(gen_random_uuid(),p_operation,CASE WHEN p_action = 'purchase' THEN 'pending_order' ELSE 'pending_refund' END,
        'pending_projection',saved.authority_snapshot,saved.transfer,receipt_finality);
    UPDATE piggyvest_savings_exit_execution.operations SET state = 'pending_projection',
      finality = receipt_finality, finalized_at = clock_timestamp() WHERE operation_id = p_operation;
  END IF;
  SELECT * INTO queued FROM piggyvest_savings_exit_execution.projection_queue WHERE operation_id = p_operation;
  IF NOT FOUND OR queued.finality <> receipt_finality OR queued.transfer <> saved.transfer
    OR queued.authority_snapshot IS DISTINCT FROM saved.authority_snapshot THEN
    RAISE EXCEPTION 'exit accounting requires hardened queue evidence' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_savings_exit_execution.accounting_receipts
    WHERE operation_id = p_operation AND evidence_id = evidence.evidence_id AND projection_id = queued.projection_id) THEN
    RETURN jsonb_build_object('state','accounted','operationId',p_operation);
  END IF;
  result := jsonb_build_object('state','pending_projection','operationId',p_operation);
  SELECT * INTO authority FROM piggyvest_savings_exit_execution.accounting_authorities WHERE operation_id = p_operation;
  IF NOT FOUND THEN RETURN result; END IF;
  amount := (saved.transfer->>'amountKobo')::bigint;
  IF authority.provider_fee_kobo <> (evidence.receipt->>'feeKobo')::bigint OR authority.provider_fee_kobo <> 0 THEN
    RETURN result;
  END IF;
  IF p_action = 'purchase' THEN
    IF authority.contract <> 'purchase_existing_order' OR authority.platform_fee_kobo + authority.merchant_amount_kobo <> amount THEN
      RETURN result;
    END IF;
    SELECT * INTO purchase FROM piggyvest_purchase_preparation.intents WHERE operation_id = p_operation;
    SELECT * INTO quote FROM piggyvest_purchase_preparation.quotes WHERE id = purchase.quote_id;
    IF quote.id IS NULL OR quote.revision_id::text <> saved.authority_snapshot->>'revisionId'
      OR purchase.actor_id <> p_actor OR (purchase.receipt->>'savingsKobo')::numeric <> amount
      OR (purchase.receipt->>'otherPaymentKobo')::numeric <> 0 OR (purchase.receipt->>'paidInterestKobo')::numeric <> 0 THEN
      RETURN result;
    END IF;
    SELECT * INTO target_order FROM public.orders WHERE id = authority.order_id FOR UPDATE;
    IF NOT FOUND OR target_order.merchant_id IS DISTINCT FROM p_merchant OR target_order.customer_id IS DISTINCT FROM p_customer
      OR target_order.currency IS DISTINCT FROM 'NGN' OR target_order.payment_status IS DISTINCT FROM 'unpaid'
      OR target_order.amount_paid IS DISTINCT FROM 0::numeric OR target_order.shipping_status IS DISTINCT FROM 'pending'
      OR target_order.total IS DISTINCT FROM amount::numeric / 100
      OR target_order.subtotal IS DISTINCT FROM quote.current_device_kobo::numeric / 100
      OR target_order.shipping_fee IS DISTINCT FROM quote.delivery_kobo::numeric / 100
      OR target_order.tax_amount IS DISTINCT FROM quote.tax_kobo::numeric / 100
      OR target_order.discount_amount IS DISTINCT FROM 0::numeric
      OR EXISTS (SELECT 1 FROM public.transactions WHERE order_id = authority.order_id)
      OR (SELECT count(*) FROM public.order_items WHERE order_id = authority.order_id) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = authority.order_id AND product_id = quote.product_id
        AND variant_id IS NOT DISTINCT FROM quote.variant_id AND quantity = quote.quantity
        AND price * quantity = quote.current_device_kobo::numeric / 100) THEN
      RETURN result;
    END IF;
  ELSE
    IF authority.contract <> 'external_principal_refund' OR authority.platform_fee_kobo <> 0 OR authority.merchant_amount_kobo <> 0
      OR (saved.authority_snapshot->>'cancellationFeeKobo')::numeric <> 0
      OR NOT EXISTS (SELECT 1 FROM piggyvest_cancel_plan.intents WHERE operation_id = p_operation
        AND command->>'actorId' = p_actor::text AND (command->>'principalKobo')::numeric = amount) THEN
      RETURN result;
    END IF;
  END IF;
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,
    gateway_reference,platform_fee,merchant_amount,description,metadata)
    VALUES(authority.transaction_id,p_merchant,authority.order_id,CASE WHEN p_action = 'purchase' THEN 'payment' ELSE 'refund' END,
      amount::numeric / 100,'NGN','completed','piggyvest',evidence.provider_transaction_id,
      authority.platform_fee_kobo::numeric / 100,authority.merchant_amount_kobo::numeric / 100,
      'Canonical savings exit',jsonb_build_object('savings_exit_operation_id',p_operation,'goal_id',p_goal,
        'customer_id',p_customer,'evidence_id',evidence.evidence_id,'accounting_terms',authority.approved_terms_reference));
  PERFORM piggyvest_savings_ledger.apply(p_integration,p_merchant,p_customer,p_goal,
    jsonb_build_object('operationId',authority.settlement_id,'kind','settle_reservation',
      'principalKobo',0,'interestKobo',0,'evidenceId',evidence.evidence_id::text,'referenceId',p_operation));
  IF p_action = 'purchase' THEN
    UPDATE public.orders SET payment_status = 'paid', payment_method = 'savings', amount_paid = amount::numeric / 100,
      updated_at = clock_timestamp() WHERE id = authority.order_id;
  END IF;
  INSERT INTO piggyvest_savings_exit_execution.accounting_receipts
    (operation_id,projection_id,evidence_id,transaction_id,settlement_id,state)
    VALUES(p_operation,queued.projection_id,evidence.evidence_id,authority.transaction_id,authority.settlement_id,'accounted');
  RETURN jsonb_build_object('state','accounted','operationId',p_operation);
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_exit_execution.consume_evidence(uuid,uuid,uuid,uuid,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
