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
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_quote->'groups') LOOP
    IF jsonb_typeof(v_group->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(v_group->'members') = 0 THEN RAISE EXCEPTION 'redvault_group_invalid'; END IF;
    SELECT sum((member->>'quantity')::bigint), sum((member->>'allocationKobo')::bigint) INTO v_group_units, v_group_sum
      FROM jsonb_array_elements(v_group->'members') AS entry(member);
    IF v_group_sum IS DISTINCT FROM (v_group->>'discountKobo')::bigint
      OR v_group_sum IS DISTINCT FROM floor(((v_group->>'lineSubtotalKobo')::numeric * 5 + 50) / 100)::bigint
      OR v_group_units * (v_group->>'unitPriceKobo')::bigint IS DISTINCT FROM (v_group->>'lineSubtotalKobo')::bigint THEN
      RAISE EXCEPTION 'redvault_group_total_mismatch';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_group->'members') AS member(value)
      LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_quote->'lines') AS line(value)
        WHERE value->>'lineId' = member.value->>'lineId') AS line ON true
      WHERE line.value IS NULL OR (line.value->>'quantity') IS DISTINCT FROM member.value->>'quantity'
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
      GROUP BY member.value->>'lineId' HAVING count(*) > 1) THEN RAISE EXCEPTION 'redvault_group_binding_invalid'; END IF;
  RETURN v_groups;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_redvault_snapshot(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.validate_redvault_snapshot(uuid,jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.reject_redvault_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE order_id IN (OLD.order_id, NEW.order_id)) THEN
    RAISE EXCEPTION 'redvault_order_snapshot_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION private.reject_redvault_item_mutation() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.reject_redvault_item_mutation() OWNER TO postgres;
CREATE TRIGGER reject_redvault_item_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION private.reject_redvault_item_mutation();
