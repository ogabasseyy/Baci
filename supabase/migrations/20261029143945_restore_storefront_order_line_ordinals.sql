-- The October storefront-order rewrite omitted the request ordinal added in
-- 20260828080000. Restore the same contract without replacing the newer
-- pricing, inventory, or authorization logic. REDVAULT's signed allocation
-- and voucher bindings must refer to the actual persisted order line.
DO $restore_line_ordinals$
DECLARE
  v_definition text;
  v_anchors text[] := ARRAY[
    $old$    offer_labels_snapshotted BOOLEAN
  ) ON COMMIT DROP;$old$,
    $old$    offer_id, offer_condition, offer_grade, offer_condition_notes,
    offer_labels_snapshotted
  )
  SELECT$old$,
    $old$    offer.id IS NOT NULL
  FROM ($old$,
    $old$      GREATEST(COALESCE((item->>'assurance_fee')::numeric, 0), 0) AS assurance_fee
    FROM jsonb_array_elements(p_items) AS item$old$,
    $old$  IF v_invalid_item_count > 0 THEN$old$,
    $old$  INSERT INTO public.order_items (
    order_id,
    product_id,$old$,
    $old$  SELECT
    v_order_id,
    t.product_id,$old$,
    $old$    t.offer_labels_snapshotted
  FROM tmp_storefront_order_items t;$old$
  ];
  v_replacements text[] := ARRAY[
    $new$    offer_labels_snapshotted BOOLEAN,
    line_ordinal INTEGER
  ) ON COMMIT DROP;$new$,
    $new$    offer_id, offer_condition, offer_grade, offer_condition_notes,
    offer_labels_snapshotted,
    line_ordinal
  )
  SELECT$new$,
    $new$    offer.id IS NOT NULL,
    r.line_ordinal
  FROM ($new$,
    $new$      GREATEST(COALESCE((item->>'assurance_fee')::numeric, 0), 0) AS assurance_fee,
      CASE
        WHEN item->>'__baci_line_ordinal' !~ '^[0-9]+$' THEN NULL
        WHEN length(item->>'__baci_line_ordinal') > 10 THEN NULL
        WHEN (item->>'__baci_line_ordinal')::numeric < 1
          OR (item->>'__baci_line_ordinal')::numeric > 2147483647 THEN NULL
        ELSE (item->>'__baci_line_ordinal')::integer
      END AS line_ordinal
    FROM jsonb_array_elements(p_items) AS item$new$,
    $new$  IF EXISTS (
    SELECT 1 FROM tmp_storefront_order_items
    WHERE line_ordinal IS NOT NULL
    GROUP BY line_ordinal HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_line_ordinal';
  END IF;

  IF v_invalid_item_count > 0 THEN$new$,
    $new$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,$new$,
    $new$  SELECT
    v_order_id,
    t.line_ordinal,
    t.product_id,$new$,
    $new$    t.offer_labels_snapshotted
  FROM tmp_storefront_order_items t
  ORDER BY t.line_ordinal NULLS LAST;$new$
  ];
  v_index integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO STRICT v_definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24;
  IF pg_catalog.strpos(v_definition, 'line_ordinal') > 0 THEN
    RAISE EXCEPTION 'storefront order ordinal preimage unexpectedly changed';
  END IF;
  FOR v_index IN 1..pg_catalog.array_length(v_anchors, 1) LOOP
    IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchors[v_index], '')))
       / pg_catalog.length(v_anchors[v_index]) <> 1 THEN
      RAISE EXCEPTION 'storefront order ordinal anchor % missing or ambiguous', v_index;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_anchors[v_index], v_replacements[v_index]);
  END LOOP;
  EXECUTE v_definition;
END;
$restore_line_ordinals$;
