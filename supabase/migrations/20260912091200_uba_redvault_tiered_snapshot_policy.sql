ALTER TABLE private.uba_redvault_applications
  ADD COLUMN pricing_policy_version text NOT NULL DEFAULT 'fixed5_v1',
  ADD CONSTRAINT uba_redvault_applications_pricing_policy_version_check
    CHECK (pricing_policy_version IN ('fixed5_v1', 'mou_tiered_v1'));

CREATE OR REPLACE FUNCTION private.validate_redvault_discount_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'redvault_discount_binding_is_immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE id = NEW.discount_code_id
      AND merchant_id = NEW.merchant_id
      AND discount_type = 'percentage'
      AND discount_value IN (5, 10)
  ) THEN RAISE EXCEPTION 'redvault_binding_invalid'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.validate_redvault_discount_binding() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_redvault_discount_binding() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_redvault_snapshot(p_order_id uuid, p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_line jsonb;
  v_group jsonb;
  v_item public.order_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_eligible bigint := 0;
  v_units bigint := 0;
  v_members jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_group_sum bigint;
  v_group_units bigint;
  v_rate integer;
BEGIN
  IF jsonb_typeof(p_quote->'lines') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_quote->'groups') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_quote->'lines') NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(p_quote->'groups') NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'redvault_quote_invalid';
  END IF;
  IF (SELECT count(*) FROM public.order_items WHERE order_id = p_order_id)
    IS DISTINCT FROM jsonb_array_length(p_quote->'lines')::bigint
    OR (SELECT count(DISTINCT value->>'lineId') FROM jsonb_array_elements(p_quote->'lines'))
    IS DISTINCT FROM jsonb_array_length(p_quote->'lines')::bigint THEN
    RAISE EXCEPTION 'redvault_line_count_mismatch';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote->'lines') LOOP
    SELECT * INTO STRICT v_item FROM public.order_items
      WHERE order_id = p_order_id AND line_id = (v_line->>'lineId')::integer FOR SHARE;
    SELECT * INTO STRICT v_product FROM public.products WHERE id = v_item.product_id FOR SHARE;
    IF v_item.product_id::text IS DISTINCT FROM v_line->>'productId'
      OR v_item.variant_id::text IS DISTINCT FROM v_line->>'variantId'
      OR v_item.condition IS DISTINCT FROM v_line->>'condition'
      OR COALESCE(v_item.variant_attributes, '{}'::jsonb) IS DISTINCT FROM COALESCE(NULLIF(v_line->'variantAttributes', 'null'::jsonb), '{}'::jsonb)
      OR v_item.price * 100 IS DISTINCT FROM (v_line->>'unitPriceKobo')::numeric
      OR v_item.quantity IS DISTINCT FROM (v_line->>'quantity')::integer
      OR v_item.vat_category_code IS DISTINCT FROM v_line->>'vatCategoryCode'
      OR v_item.vat_rate * 100 IS DISTINCT FROM (v_line->>'vatRateBp')::numeric
      OR NULLIF(trim(v_product.brand), '') IS DISTINCT FROM v_line->>'brand'
      OR NULLIF(trim(v_product.name), '') IS DISTINCT FROM v_line->>'name'
      OR jsonb_typeof(v_line->'unitDiscountsKobo') IS DISTINCT FROM 'array'
      OR v_item.quantity IS DISTINCT FROM jsonb_array_length(v_line->'unitDiscountsKobo')
      OR v_item.quantity < 1 THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
    v_units := v_units + v_item.quantity;
    IF v_units > 10000 THEN RAISE EXCEPTION 'redvault_allocation_limit'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_line->'unitDiscountsKobo') AS unit(amount)
      WHERE amount IS NULL OR amount !~ '^[0-9]+$' OR amount::numeric > v_item.price * 100) THEN
      RAISE EXCEPTION 'redvault_allocation_invalid';
    END IF;
    IF (SELECT sum(amount::bigint) FROM jsonb_array_elements_text(v_line->'unitDiscountsKobo') AS unit(amount))
      IS DISTINCT FROM (v_line->>'discountKobo')::bigint THEN RAISE EXCEPTION 'redvault_allocation_invalid'; END IF;
    v_subtotal := v_subtotal + (v_line->>'unitPriceKobo')::bigint * v_item.quantity;
    v_discount := v_discount + (v_line->>'discountKobo')::bigint;
  END LOOP;
  IF v_subtotal IS DISTINCT FROM (p_quote->>'productSubtotalKobo')::bigint
    OR v_discount IS DISTINCT FROM (p_quote->>'discountKobo')::bigint OR v_discount <= 0 THEN
    RAISE EXCEPTION 'redvault_total_mismatch';
  END IF;
  v_rate := CASE WHEN (p_quote->>'eligibleSubtotalKobo')::bigint < 20000000 THEN 10 ELSE 5 END;
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_quote->'groups') LOOP
    IF jsonb_typeof(v_group->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(v_group->'members') = 0 THEN RAISE EXCEPTION 'redvault_group_invalid'; END IF;
    SELECT sum((member->>'quantity')::bigint), sum((member->>'allocationKobo')::bigint) INTO v_group_units, v_group_sum
      FROM jsonb_array_elements(v_group->'members') AS entry(member);
    IF v_group_sum IS DISTINCT FROM (v_group->>'discountKobo')::bigint
      OR v_group_sum IS DISTINCT FROM floor(((v_group->>'lineSubtotalKobo')::numeric * v_rate + 50) / 100)::bigint
      OR v_group_units * (v_group->>'unitPriceKobo')::bigint IS DISTINCT FROM (v_group->>'lineSubtotalKobo')::bigint THEN
      RAISE EXCEPTION 'redvault_group_total_mismatch';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_group->'members') AS member(value)
      LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_quote->'lines') AS line(value)
        WHERE value->>'lineId' = member.value->>'lineId') AS line ON true
      LEFT JOIN public.order_items oi ON oi.order_id = p_order_id AND oi.line_id = (member.value->>'lineId')::integer
      WHERE line.value IS NULL OR oi.id IS NULL
        OR (line.value->>'quantity') IS DISTINCT FROM member.value->>'quantity'
        OR line.value->>'discountKobo' IS DISTINCT FROM member.value->>'allocationKobo'
        OR line.value->>'productId' IS DISTINCT FROM v_group->>'productId'
        OR line.value->>'variantId' IS DISTINCT FROM v_group->>'variantId'
        OR line.value->>'condition' IS DISTINCT FROM v_group->>'condition'
        OR line.value->>'unitPriceKobo' IS DISTINCT FROM v_group->>'unitPriceKobo'
        OR line.value->>'vatCategoryCode' IS DISTINCT FROM v_group->>'vatCategoryCode'
        OR line.value->>'vatRateBp' IS DISTINCT FROM v_group->>'vatRateBp'
        OR COALESCE(NULLIF(line.value->'variantAttributes','null'::jsonb),'{}'::jsonb) IS DISTINCT FROM v_group->'variantAttributes'
    ) THEN RAISE EXCEPTION 'redvault_group_binding_invalid'; END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT amount::bigint AS allocation, row_number() OVER (ORDER BY (line.value->>'lineId')::integer, unit.ordinality) AS position
        FROM jsonb_array_elements(v_group->'members') AS member(value)
        JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_quote->'lines') AS line(value) WHERE value->>'lineId' = member.value->>'lineId') AS line ON true
        CROSS JOIN LATERAL jsonb_array_elements_text(line.value->'unitDiscountsKobo') WITH ORDINALITY AS unit(amount,ordinality)
      ) AS units WHERE allocation <> v_group_sum / v_group_units + CASE WHEN position <= v_group_sum % v_group_units THEN 1 ELSE 0 END
    ) THEN RAISE EXCEPTION 'redvault_unit_allocation_mismatch'; END IF;
    SELECT jsonb_agg(member.value || jsonb_build_object('orderItemId', oi.id) ORDER BY member.ordinality)
      INTO v_members FROM jsonb_array_elements(v_group->'members') WITH ORDINALITY AS member(value, ordinality)
      JOIN public.order_items oi ON oi.order_id = p_order_id AND oi.line_id = (member.value->>'lineId')::integer;
    v_groups := v_groups || jsonb_build_array(v_group || jsonb_build_object('members', v_members));
    v_eligible := v_eligible + (v_group->>'lineSubtotalKobo')::bigint;
  END LOOP;
  IF v_eligible IS DISTINCT FROM (p_quote->>'eligibleSubtotalKobo')::bigint
    OR (SELECT sum((value->>'discountKobo')::bigint) FROM jsonb_array_elements(p_quote->'groups')) IS DISTINCT FROM v_discount
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_quote->'groups') AS grp(value) GROUP BY value->>'key' HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_quote->'groups') AS grp(value)
      CROSS JOIN LATERAL jsonb_array_elements(grp.value->'members') AS member(value)
      GROUP BY member.value->>'lineId' HAVING count(*) > 1)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_quote->'lines') line(value)
      WHERE (line.value->>'discountKobo')::bigint > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_quote->'groups') grp(value)
          CROSS JOIN LATERAL jsonb_array_elements(grp.value->'members') member(value)
          WHERE member.value->>'lineId' = line.value->>'lineId'
        )
    ) THEN RAISE EXCEPTION 'redvault_group_binding_invalid'; END IF;
  RETURN v_groups;
END;
$$;
ALTER FUNCTION private.validate_redvault_snapshot(uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.validate_redvault_snapshot(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_storefront_redvault_order_draft(p_order jsonb, p_quote jsonb)
RETURNS TABLE (id uuid, quote_version_id uuid, quote_payload_hash text, proof_context jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing private.uba_redvault_applications%ROWTYPE;
  v_customer_email text := lower(trim(p_order->>'customer_email'));
  v_key text := NULLIF(p_order->>'checkout_idempotency_key', '');
  v_request_hash text := private.transaction_discount_payload_hash(p_order);
  v_terms jsonb;
  v_merchant_id uuid := NULLIF(p_order ->> 'merchant_id', '')::uuid;
  v_code_id uuid;
  v_order_id uuid;
  v_quote_version_id uuid := extensions.gen_random_uuid();
  v_hash text := private.transaction_discount_payload_hash(p_quote);
  v_application_id uuid;
  v_discount_kobo bigint;
  v_eligible_subtotal_kobo bigint;
  v_proof_groups jsonb;
BEGIN
  IF COALESCE(auth.jwt() ->> 'storefront_order_context', '') <> 'route'
    OR (auth.jwt() ->> 'storefront_order_merchant_id') IS DISTINCT FROM v_merchant_id::text THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  IF NULLIF(lower(trim(p_order ->> 'customer_email')), '') IS NULL
    OR auth.jwt()->>'storefront_redvault_customer_email' IS DISTINCT FROM v_customer_email
    OR COALESCE(NULLIF(p_order ->> 'user_id', ''), 'guest') IS DISTINCT FROM COALESCE(auth.uid()::text, 'guest') THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  IF v_merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid THEN RAISE EXCEPTION 'redvault_merchant_forbidden'; END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN RAISE EXCEPTION 'redvault_idempotency_key_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_merchant_id::text || v_customer_email || v_key, 0));
  SELECT * INTO v_existing FROM private.uba_redvault_applications AS application
    WHERE application.merchant_id = v_merchant_id AND application.customer_email = v_customer_email AND application.checkout_key = v_key;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM auth.uid() OR v_existing.request_hash IS DISTINCT FROM v_request_hash OR v_existing.quote_payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'checkout_idempotency_conflict';
    END IF;
    IF v_existing.status NOT IN ('draft', 'pending') THEN RAISE EXCEPTION 'order_not_reusable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.orders AS existing_order WHERE existing_order.id = v_existing.order_id AND existing_order.merchant_id = v_merchant_id AND lower(trim(existing_order.customer_email)) = v_customer_email AND payment_method = 'uba_redvault' AND payment_status = 'unpaid') THEN RAISE EXCEPTION 'order_not_reusable'; END IF;
    RETURN QUERY SELECT v_existing.order_id, v_existing.quote_version_id, v_existing.quote_payload_hash, v_existing.proof_context;
    RETURN;
  END IF;
  SELECT commercial_terms INTO v_terms FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault';
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' AND enabled) THEN RAISE EXCEPTION 'redvault_disabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' AND commercial_terms_confirmed) THEN RAISE EXCEPTION 'redvault_commercial_terms_missing'; END IF;
  IF jsonb_typeof(v_terms) IS DISTINCT FROM 'object' OR NOT (v_terms ?& ARRAY['campaign_dates','minimum_spend','caps','usage_limits','stacking','split_payments','funding_fees','refund_usage_restoration','operations_owner'])
    OR EXISTS (SELECT 1 FROM jsonb_each(v_terms) WHERE value = 'null'::jsonb OR value = '""'::jsonb) THEN RAISE EXCEPTION 'redvault_commercial_terms_missing'; END IF;
  SELECT discount_code_id INTO v_code_id FROM private.uba_redvault_discount_binding
    WHERE merchant_id = v_merchant_id AND partnership = 'uba_redvault';
  IF v_code_id IS NULL THEN RAISE EXCEPTION 'redvault_binding_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id AND merchant_id = v_merchant_id AND discount_type = 'percentage' AND discount_value IN (5, 10) AND is_active IS TRUE) THEN RAISE EXCEPTION 'redvault_binding_invalid'; END IF;
  IF jsonb_typeof(p_quote -> 'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(p_quote -> 'groups') IS DISTINCT FROM 'array'
    OR COALESCE(p_quote ->> 'discountKobo', '') !~ '^[1-9][0-9]*$'
    OR COALESCE(p_quote ->> 'eligibleSubtotalKobo', '') !~ '^[1-9][0-9]*$'
    OR COALESCE(p_quote ->> 'productSubtotalKobo', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'redvault_quote_invalid'; END IF;
  v_discount_kobo := (p_quote ->> 'discountKobo')::bigint;
  v_eligible_subtotal_kobo := (p_quote ->> 'eligibleSubtotalKobo')::bigint;
  PERFORM 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id AND (
    starts_at > now() OR expires_at <= now() OR COALESCE(minimum_purchase_amount,0) <> 0
    OR maximum_discount_amount < v_discount_kobo::numeric / 100 OR applies_to <> 'all'
    OR COALESCE(product_ids,'[]'::jsonb) <> '[]'::jsonb OR COALESCE(category_ids,'[]'::jsonb) <> '[]'::jsonb
  )) THEN RAISE EXCEPTION 'redvault_commercial_configuration_unsupported'; END IF;
  IF COALESCE((p_order ->> 'discount_amount')::numeric, -1) <> v_discount_kobo::numeric / 100 THEN RAISE EXCEPTION 'redvault_discount_mismatch'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_quote -> 'lines')) <> (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_order -> 'items', '[]'::jsonb))) THEN RAISE EXCEPTION 'redvault_line_count_mismatch'; END IF;
  IF jsonb_array_length(p_quote->'lines') > 10000 OR (SELECT sum((value->>'quantity')::numeric) FROM jsonb_array_elements(p_quote->'lines')) > 10000 THEN RAISE EXCEPTION 'redvault_allocation_limit'; END IF;
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
  SELECT created.id INTO v_order_id FROM public.create_storefront_order(
    p_merchant_id => v_merchant_id, p_customer_email => p_order ->> 'customer_email', p_customer_name => p_order ->> 'customer_name', p_items => COALESCE(p_order -> 'items', '[]'::jsonb), p_customer_phone => NULLIF(p_order ->> 'customer_phone', ''),
    p_shipping_fee => COALESCE((p_order ->> 'shipping_fee')::numeric, 0), p_discount_amount => v_discount_kobo::numeric / 100, p_tax_amount => COALESCE((p_order ->> 'tax_amount')::numeric, 0), p_payment_method => 'uba_redvault', p_payment_status => 'unpaid', p_shipping_status => 'pending',
    p_shipping_address => p_order -> 'shipping_address', p_source => COALESCE(NULLIF(p_order ->> 'source', ''), 'online_store'), p_notes => NULLIF(p_order ->> 'notes', ''), p_ad_tracking => p_order -> 'ad_tracking', p_selected_quote_id => NULLIF(p_order ->> 'selected_quote_id', '')::uuid,
    p_shipping_provider => NULLIF(p_order ->> 'shipping_provider', ''), p_tracking_number => NULLIF(p_order ->> 'tracking_number', ''), p_user_id => NULLIF(p_order ->> 'user_id', '')::uuid, p_tax_basis => 'exclusive', p_gift_wrapping_fee => COALESCE((p_order ->> 'gift_wrapping_fee')::numeric, 0),
    p_expected_total => NULLIF(p_order ->> 'expected_total', '')::numeric, p_checkout_idempotency_key => NULLIF(p_order ->> 'checkout_idempotency_key', ''), p_checkout_request_hash => NULLIF(p_order ->> 'checkout_request_hash', '')
  ) AS created;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'redvault_order_creation_failed'; END IF;
  v_proof_groups := private.validate_redvault_snapshot(v_order_id, p_quote);
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE orders.id = v_order_id AND orders.merchant_id = v_merchant_id AND lower(trim(customer_email)) = v_customer_email AND payment_status = 'unpaid' AND payment_method = 'uba_redvault' AND discount_amount * 100 = v_discount_kobo) THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
  INSERT INTO private.uba_redvault_applications AS application (order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash, quote_payload, discount_kobo, eligible_subtotal_kobo, pricing_policy_version, status, customer_email, user_id, checkout_key, request_hash)
  VALUES (v_order_id, v_code_id, v_merchant_id, v_quote_version_id, v_hash, p_quote, v_discount_kobo, v_eligible_subtotal_kobo, 'mou_tiered_v1', 'draft', v_customer_email, auth.uid(), v_key, v_request_hash) RETURNING application.id INTO v_application_id;
  INSERT INTO private.uba_redvault_line_allocations (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo, product_id, variant_id, condition, variant_attributes, unit_price_kobo, vat_category_code, vat_rate_bp, tax_basis)
  SELECT v_application_id, oi.id, (line.value ->> 'lineId')::integer, unit.value_ordinal, unit.value::bigint, oi.product_id, oi.variant_id, oi.condition, COALESCE(oi.variant_attributes, '{}'::jsonb), round(oi.price * 100)::bigint, oi.vat_category_code, round(COALESCE(oi.vat_rate, 0) * 100)::integer, 'exclusive'
  FROM jsonb_array_elements(p_quote -> 'lines') AS line(value)
  JOIN public.order_items oi ON oi.order_id = v_order_id AND oi.line_id = (line.value ->> 'lineId')::integer
  JOIN LATERAL jsonb_array_elements_text(line.value -> 'unitDiscountsKobo') WITH ORDINALITY AS unit(value, value_ordinal) ON true;
  UPDATE private.uba_redvault_applications SET proof_context =
    jsonb_build_object('applicationId', v_application_id, 'discountKobo', v_discount_kobo, 'eligibleSubtotalKobo', v_eligible_subtotal_kobo,
      'productSubtotalKobo', (p_quote ->> 'productSubtotalKobo')::bigint, 'groups', v_proof_groups, 'taxBasis', 'exclusive') WHERE order_id = v_order_id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  RETURN QUERY SELECT v_order_id, v_quote_version_id, v_hash,
    jsonb_build_object('applicationId', v_application_id, 'discountKobo', v_discount_kobo, 'eligibleSubtotalKobo', v_eligible_subtotal_kobo,
      'productSubtotalKobo', (p_quote ->> 'productSubtotalKobo')::bigint, 'groups', v_proof_groups, 'taxBasis', 'exclusive');
END;
$$;
ALTER FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) TO authenticated;
