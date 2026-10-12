CREATE FUNCTION pg_temp.plan_goal(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old_goal public.customer_savings_goals%ROWTYPE; product public.products%ROWTYPE;
  variant public.product_variants%ROWTYPE; saved public.customer_savings_goals%ROWTYPE;
  target numeric; snapshot jsonb; stored_snapshot jsonb; result record; feature record; goal_uuid uuid;
  variant_label text; variant_count integer;
BEGIN
  SELECT * INTO STRICT old_goal FROM public.customer_savings_goals WHERE id=(payload->>'oldGoalId')::uuid;
  SELECT * INTO STRICT product FROM public.products WHERE id=old_goal.product_id
    AND merchant_id=(payload->>'merchantId')::uuid AND status='active';
  SELECT count(*) INTO variant_count FROM public.product_variants WHERE product_id=product.id
    AND merchant_id=(payload->>'merchantId')::uuid AND is_inventory_anchor IS NOT TRUE;
  IF old_goal.variant_id IS NULL AND variant_count>0 THEN
    RAISE EXCEPTION 'test plan exact catalogue variant required';
  END IF;
  IF old_goal.variant_id IS NOT NULL THEN
    SELECT * INTO STRICT variant FROM public.product_variants WHERE id=old_goal.variant_id
      AND product_id=product.id AND merchant_id=(payload->>'merchantId')::uuid
      AND is_inventory_anchor IS NOT TRUE;
    SELECT string_agg(label||': '||value,' · ' ORDER BY axis) INTO variant_label FROM (
      SELECT key AS axis,value,CASE lower(regexp_replace(trim(key),'[[:space:]-]+','_','g'))
        WHEN 'ram' THEN 'RAM' WHEN 'rom' THEN 'ROM' WHEN 'sim_type' THEN 'SIM Type'
        WHEN 'storage' THEN 'Storage' ELSE initcap(replace(lower(key),'_',' ')) END AS label
      FROM jsonb_each_text(coalesce(nullif(to_jsonb(variant)->'attributes','null'::jsonb),'{}'::jsonb)) WHERE value<>''
    ) labels;
    variant_label:=coalesce(variant_label,nullif(trim(variant.sku),''));
  END IF;
  target:=coalesce(variant.price_override,product.price);
  IF target IS NULL OR target<=0 OR target*100>9007199254740991 OR trunc(target*100)<>target*100 THEN
    RAISE EXCEPTION 'test plan catalogue price refused';
  END IF;
  snapshot:=jsonb_build_object('name',product.name,'price',target,'selectionStatus','exact',
    'variantId',variant.id,'variantLabel',variant_label,'condition',coalesce(variant.condition,product.condition),
    'image',coalesce(nullif(trim(variant.primary_image),''),
      nullif(trim(to_jsonb(variant)->'images'->>0),''),nullif(trim(to_jsonb(product)->'images'->>0),'')));
  stored_snapshot:=jsonb_build_object('name',product.name,'price',target,'cataloguePrice',target,
    'selectionStatus','exact','variantId',variant.id,'variantLabel',variant.sku,
    'condition',coalesce(variant.condition,product.condition),
    'image',coalesce(variant.primary_image,to_jsonb(variant)->'images'->>0,to_jsonb(product)->'images'->>0));
  PERFORM set_config('request.jwt.claim.sub',payload->>'actorId',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',payload->>'actorId','role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO STRICT feature FROM public.get_customer_savings_feature_settings(
    (payload->>'customerId')::uuid,(payload->>'merchantId')::uuid);
  EXECUTE 'RESET ROLE';
  IF feature.customer_device_savings_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'test plan merchant savings feature disabled';
  END IF;
  SELECT * INTO saved FROM public.customer_savings_goals WHERE metadata->>'stagingTestPlanKey'=payload->>'planKey';
  IF FOUND AND saved.id=(payload->>'oldGoalId')::uuid THEN
    RAISE EXCEPTION 'test plan old goal reuse refused';
  END IF;
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT * INTO STRICT result FROM public.create_customer_savings_goal(
      p_customer_id=>(payload->>'customerId')::uuid,p_merchant_id=>(payload->>'merchantId')::uuid,
      p_product_id=>product.id,p_variant_id=>variant.id,p_title=>payload->>'title',
      p_product_snapshot=>snapshot,p_target_amount=>target,p_initial_contribution_amount=>0::numeric,
      p_contribution_amount=>1::numeric,p_contribution_frequency=>'daily'::text,
      p_preferred_debit_time=>NULL::time,p_start_date=>'2026-10-02'::date,
      p_maturity_date=>'2026-10-06'::date,p_source_mode=>'manual'::text,
      p_saved_payment_method_id=>NULL::uuid,p_terms_accepted_at=>(payload->>'acceptedAt')::timestamptz,
      p_non_withdrawable_accepted_at=>(payload->>'acceptedAt')::timestamptz,
      p_auto_debit_authorized_at=>NULL::timestamptz,p_early_end_fee_accepted_at=>NULL::timestamptz,
      p_break_fee_percent=>0::numeric,p_metadata=>payload->'metadata',
      p_initial_contribution_idempotency_key=>payload->>'planKey',p_goal_idempotency_key=>payload->>'planKey');
    EXECUTE 'RESET ROLE';
    IF result.success IS NOT TRUE OR result.goal_id IS NULL OR result.current_amount<>0
      OR result.contribution_id IS NOT NULL OR result.goal_status<>'active' THEN
      RAISE EXCEPTION 'test plan official goal acknowledgement refused';
    END IF;
    SELECT * INTO STRICT saved FROM public.customer_savings_goals WHERE id=result.goal_id;
  goal_uuid:=saved.id;
  IF goal_uuid=(payload->>'oldGoalId')::uuid OR saved.merchant_id<>(payload->>'merchantId')::uuid
    OR saved.customer_id<>(payload->>'customerId')::uuid OR saved.product_id IS DISTINCT FROM product.id
    OR saved.variant_id IS DISTINCT FROM variant.id OR saved.product_snapshot IS DISTINCT FROM stored_snapshot
    OR saved.title IS DISTINCT FROM payload->>'title' OR saved.target_amount IS DISTINCT FROM target
    OR saved.current_amount IS DISTINCT FROM 0::numeric OR saved.initial_contribution_amount IS DISTINCT FROM 0::numeric
    OR saved.contribution_amount IS DISTINCT FROM 1::numeric OR saved.contribution_frequency IS DISTINCT FROM 'daily'
    OR saved.start_date IS DISTINCT FROM '2026-10-02'::date OR saved.maturity_date IS DISTINCT FROM '2026-10-06'::date
    OR saved.source_mode IS DISTINCT FROM 'manual' OR saved.status IS DISTINCT FROM 'active'
    OR saved.saved_payment_method_id IS NOT NULL OR saved.preferred_debit_time IS NOT NULL
    OR saved.auto_debit_authorized_at IS NOT NULL OR saved.early_end_fee_accepted_at IS NOT NULL
    OR saved.completed_at IS NOT NULL OR saved.cancelled_at IS NOT NULL OR saved.spent_at IS NOT NULL
    OR saved.applied_order_id IS NOT NULL OR saved.future_debits_cancelled_at IS NOT NULL
    OR saved.break_fee_percent IS DISTINCT FROM 0::numeric OR saved.goal_kind IS DISTINCT FROM 'legacy'
    OR saved.canonical_draft_id IS NOT NULL OR saved.canonical_actor_id IS NOT NULL
    OR saved.canonical_draft_revision_id IS NOT NULL OR saved.metadata IS DISTINCT FROM payload->'metadata'
    OR saved.terms_accepted_at IS DISTINCT FROM (payload->>'acceptedAt')::timestamptz
    OR saved.non_withdrawable_accepted_at IS DISTINCT FROM (payload->>'acceptedAt')::timestamptz
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions WHERE goal_id=goal_uuid)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE goal_id=goal_uuid)
    OR NOT EXISTS(SELECT 1 FROM public.customer_savings_goal_idempotency_keys
      WHERE merchant_id=saved.merchant_id AND customer_id=saved.customer_id
      AND idempotency_key=payload->>'planKey' AND goal_id=goal_uuid AND initial_contribution_id IS NULL)
    OR (SELECT count(*) FROM public.customer_savings_events WHERE goal_id=goal_uuid)<>1
    OR NOT EXISTS(SELECT 1 FROM public.customer_savings_events WHERE goal_id=goal_uuid
      AND merchant_id=saved.merchant_id AND customer_id=saved.customer_id AND event_type='goal_created'
      AND actor_type='customer' AND metadata=jsonb_build_object('source_mode','manual',
        'target_amount',target,'initial_contribution_amount',0)) THEN
    RAISE EXCEPTION 'test plan exact empty goal conflict';
  END IF;
  RETURN goal_uuid;
END $$;
