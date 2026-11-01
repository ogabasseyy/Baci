-- The context row gives only this trusted transaction a narrowly scoped
-- one-time transition from an ordinary prize to its chosen offer unit.
CREATE TABLE private.quiz_offer_transition_context (
 transaction_id bigint NOT NULL, order_item_id uuid NOT NULL, offer_id uuid NOT NULL,
 PRIMARY KEY (transaction_id, order_item_id)
);
ALTER TABLE private.quiz_offer_transition_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.quiz_offer_transition_context FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE definition text := pg_get_functiondef('private.guard_order_items_offer_id_snapshot()'::regprocedure);
 old text := $old$  -- UPDATE: the snapshot is immutable once stamped.$old$;
 replacement text := $new$  IF current_user = 'postgres' THEN
   IF EXISTS (
    SELECT 1 FROM private.quiz_offer_transition_context context
    WHERE context.transaction_id = pg_catalog.txid_current()
      AND context.order_item_id = OLD.id AND context.offer_id = NEW.product_offer_id
      AND OLD.offer_line IS NOT TRUE AND OLD.product_offer_id IS NULL
      AND OLD.offer_id IS NULL AND OLD.offer_id_snapshot IS NULL
      AND OLD.offer_labels_snapshotted IS NOT TRUE
      AND OLD.offer_grade IS NULL AND OLD.offer_condition_notes IS NULL
      AND NEW.offer_line IS TRUE AND NEW.offer_id = context.offer_id
      AND NEW.offer_id_snapshot = context.offer_id
      AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
      AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
      AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
      AND NEW.condition IS NOT DISTINCT FROM OLD.condition
   ) THEN RETURN NEW; END IF;
  END IF;
  -- UPDATE: the snapshot is immutable once stamped.$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
   RAISE EXCEPTION 'quiz offer guard source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END $$;

CREATE FUNCTION private.transfer_quiz_voucher_to_serialized_offer(
 p_merchant_id uuid, p_award_id uuid, p_order_id uuid, p_item_id uuid, p_item jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_offer uuid; v_product uuid; v_anchor uuid; v_condition text; v_amount numeric;
 v_grade text; v_notes text; v_offer_status text; v_old_unit uuid; v_old_variant uuid; v_old_branch uuid; v_count integer; v_requested_product uuid;
BEGIN
 v_offer := coalesce(nullif(btrim(p_item->>'offer_id'),''),nullif(btrim(p_item->>'condition_offer_id'),''))::uuid;
 IF v_offer IS NULL AND nullif(btrim(p_item->>'condition'),'') IS NULL THEN RETURN; END IF;
 v_requested_product:=coalesce(nullif(p_item->>'product_id',''),nullif(p_item->>'productId',''),nullif(p_item->>'id',''))::uuid;
 IF NOT EXISTS (
  SELECT 1 FROM public.products product LEFT JOIN public.product_variants anchor
   ON anchor.id=product.inventory_anchor_variant_id AND anchor.merchant_id=product.merchant_id
     AND anchor.product_id=product.id
  WHERE product.id=v_requested_product AND product.merchant_id=p_merchant_id
    AND public.get_effective_inventory_tracking_policy(product.inventory_tracking_policy,anchor.inventory_tracking_policy)
      IN ('serialized_strict','serialized_then_unlimited')
 ) THEN RETURN; END IF;
 IF v_offer IS NULL THEN
  SELECT offer.id,offer.status INTO v_offer,v_offer_status FROM public.product_offers offer
  WHERE offer.merchant_id=p_merchant_id AND offer.product_id=v_requested_product
    AND offer.condition=nullif(btrim(p_item->>'condition'),'');
  IF NOT FOUND THEN RETURN; END IF;
  IF v_offer_status IS DISTINCT FROM 'active' THEN
   RAISE EXCEPTION 'serialized_inventory_unavailable' USING ERRCODE='55000';
  END IF;
 END IF;
 IF public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,v_requested_product) IS NOT TRUE THEN
   RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.orders orders WHERE orders.id=p_order_id AND orders.merchant_id=p_merchant_id
   AND orders.shipping_status IN ('pending','processing') AND orders.cancelled_at IS NULL
   AND orders.shipped_at IS NULL AND orders.delivered_at IS NULL AND orders.shipment_id IS NULL
   AND orders.tracking_number IS NULL AND orders.shipment_booking_lock_token IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.shipments shipment WHERE shipment.order_id=orders.id)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_prize_not_transferable' USING ERRCODE='55000'; END IF;
 SELECT item.product_id,item.condition INTO v_product,v_condition FROM public.order_items item
 WHERE item.id=p_item_id AND item.order_id=p_order_id AND item.product_id=v_requested_product AND item.variant_id IS NULL
   AND (nullif(btrim(p_item->>'condition'),'') IS NULL OR item.condition=p_item->>'condition')
   AND item.quantity=1 AND item.offer_line IS NOT TRUE AND item.product_offer_id IS NULL
   AND item.offer_id IS NULL AND item.offer_id_snapshot IS NULL
   AND item.offer_labels_snapshotted IS NOT TRUE
   AND item.offer_grade IS NULL AND item.offer_condition_notes IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023'; END IF;
 SELECT product.inventory_anchor_variant_id INTO v_anchor FROM public.products product
 WHERE product.id=v_product AND product.merchant_id=p_merchant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023'; END IF;
 SELECT award.amount INTO v_amount FROM public.quiz_awards award
 JOIN public.orders prize_order ON prize_order.id=award.reserved_order_id
   AND prize_order.merchant_id=p_merchant_id AND prize_order.customer_id=award.customer_id
 WHERE award.id=p_award_id AND award.reserved_order_id=p_order_id
   AND award.reserved_order_item_id=p_item_id AND award.product_id=v_product
   AND award.variant_id IS NULL
   AND (award.condition IS NULL OR award.condition IS NOT DISTINCT FROM v_condition)
   AND award.status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023'; END IF;
 SELECT offer.grade,offer.condition_notes INTO v_grade,v_notes FROM public.product_offers offer
 WHERE offer.id=v_offer AND offer.merchant_id=p_merchant_id AND offer.product_id=v_product
   AND offer.condition IS NOT DISTINCT FROM v_condition AND offer.status='active' AND offer.price<=v_amount
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_count FROM public.variant_inventory unit WHERE unit.order_item_id=p_item_id;
 IF v_count<>1 THEN RAISE EXCEPTION 'quiz_serialized_hold_lost' USING ERRCODE='55000'; END IF;
 SELECT unit.id,unit.variant_id,unit.branch_id INTO v_old_unit,v_old_variant,v_old_branch FROM public.variant_inventory unit
 WHERE unit.order_item_id=p_item_id AND unit.order_id=p_order_id AND unit.merchant_id=p_merchant_id
   AND unit.variant_id=v_anchor AND unit.condition_offer_id IS NULL AND unit.status='reserved' AND unit.sold_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'quiz_serialized_hold_lost' USING ERRCODE='55000'; END IF;
 UPDATE public.product_offers SET stock_quantity=stock_quantity-1 WHERE id=v_offer AND stock_quantity>=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'serialized_inventory_unavailable' USING ERRCODE='55000'; END IF;
 PERFORM private.record_variant_inventory_event(v_old_unit,p_merchant_id,v_product,v_old_variant,'reservation_released',
   'reserved','available',p_order_id,p_item_id,v_old_branch,NULL,NULL,jsonb_build_object('releaseReason','checkout_reuse','fulfillmentPath','order_reuse'));
 UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL,reserved_at=NULL,
   reservation_expires_at=NULL,updated_at=clock_timestamp() WHERE id=v_old_unit;
 INSERT INTO private.quiz_offer_transition_context VALUES (pg_catalog.txid_current(),p_item_id,v_offer);
 UPDATE public.order_items SET product_offer_id=v_offer,offer_id=v_offer,offer_id_snapshot=v_offer,
   offer_line=true,offer_grade=v_grade,offer_condition_notes=v_notes,offer_labels_snapshotted=true WHERE id=p_item_id;
 DELETE FROM private.quiz_offer_transition_context WHERE transaction_id=pg_catalog.txid_current() AND order_item_id=p_item_id;
 INSERT INTO private.serialized_offer_order_items VALUES (p_item_id,p_merchant_id,v_offer);
 PERFORM private.claim_variant_inventory_units_for_order_item_internal(p_merchant_id,p_order_id,p_item_id);
 SELECT count(*) INTO v_count FROM public.variant_inventory unit WHERE unit.order_item_id=p_item_id
   AND unit.order_id=p_order_id AND unit.merchant_id=p_merchant_id AND unit.condition_offer_id=v_offer AND unit.status='reserved';
 IF v_count<>1 OR (SELECT count(*) FROM public.variant_inventory unit WHERE unit.order_item_id=p_item_id)<>1 THEN
   RAISE EXCEPTION 'serialized_inventory_unavailable' USING ERRCODE='55000';
 END IF;
END $$;
ALTER FUNCTION private.transfer_quiz_voucher_to_serialized_offer(uuid,uuid,uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.transfer_quiz_voucher_to_serialized_offer(uuid,uuid,uuid,uuid,jsonb)
 FROM PUBLIC, anon, authenticated, service_role;

-- Bind fallback awards to the selected offer even without a route ordinal.
CREATE FUNCTION private.quiz_voucher_expected_serialized_offer(
 p_merchant_id uuid,p_product_id uuid,p_item jsonb
) RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE candidate uuid; condition_value text;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.products product LEFT JOIN public.product_variants anchor
   ON anchor.id=product.inventory_anchor_variant_id AND anchor.merchant_id=product.merchant_id
     AND anchor.product_id=product.id
  WHERE product.id=p_product_id AND product.merchant_id=p_merchant_id
   AND public.get_effective_inventory_tracking_policy(product.inventory_tracking_policy,anchor.inventory_tracking_policy)
     IN ('serialized_strict','serialized_then_unlimited')
 ) THEN RETURN NULL; END IF;
 candidate:=coalesce(nullif(btrim(p_item->>'offer_id'),''),nullif(btrim(p_item->>'condition_offer_id'),''))::uuid;
 IF candidate IS NOT NULL THEN RETURN candidate; END IF;
 condition_value:=nullif(btrim(p_item->>'condition'),'');
 IF condition_value IS NULL THEN RETURN NULL; END IF;
 SELECT offer.id INTO candidate FROM public.product_offers offer
  WHERE offer.merchant_id=p_merchant_id AND offer.product_id=p_product_id AND offer.condition=condition_value;
 RETURN candidate;
END $$;
REVOKE ALL ON FUNCTION private.quiz_voucher_expected_serialized_offer(uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE function_oid oid; definition text;
 old text := $old$    -- Update order with shipping & user fields$old$;
 replacement text := $new$    PERFORM private.transfer_quiz_voucher_to_serialized_offer(
      p_merchant_id, v_award_id, v_reserved_order_id, v_reserved_order_item_id, v_voucher_item
    );
    -- Update order with shipping & user fields$new$;
BEGIN
 SELECT proc.oid INTO STRICT function_oid FROM pg_catalog.pg_proc proc
 JOIN pg_catalog.pg_namespace namespace ON namespace.oid=proc.pronamespace
 WHERE namespace.nspname='private' AND proc.proname='create_storefront_order_with_quiz_voucher' AND proc.pronargs=23;
 definition:=pg_catalog.pg_get_functiondef(function_oid);
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
   RAISE EXCEPTION 'quiz voucher transfer source mismatch';
 END IF;
 definition:=replace(definition,old,replacement);
 old:=$old$      AND (v_voucher_line_ordinal IS NULL OR oi.line_id = v_voucher_line_ordinal)$old$;
 replacement:=$new$      AND (v_voucher_line_ordinal IS NULL OR oi.line_id = v_voucher_line_ordinal)
      AND (private.quiz_voucher_expected_serialized_offer(p_merchant_id,v_product_id,v_voucher_item) IS NULL
        OR coalesce(oi.product_offer_id,oi.offer_id,oi.offer_id_snapshot)
          = private.quiz_voucher_expected_serialized_offer(p_merchant_id,v_product_id,v_voucher_item))$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
   RAISE EXCEPTION 'quiz voucher fallback identity source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END $$;
