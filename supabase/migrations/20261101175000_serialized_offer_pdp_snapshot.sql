-- Preserve the PDP's existing snapshot shape while adding the offer-specific
-- allocation used for selected-condition stock. Source checks fail closed if
-- an earlier migration changes the function we intend to patch.
DO $$
DECLARE
  v_def text := pg_catalog.pg_get_functiondef('private.get_storefront_pdp_core_v2(uuid,text,uuid)'::regprocedure);
  v_old text;
  v_new text;
BEGIN
  v_old := $old$      product_row.merchant_id,
      product_row.category_id,$old$;
  v_new := $new$      product_row.merchant_id,
      product_row.inventory_anchor_variant_id,
      product_row.category_id,$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PDP anchor projection source mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$      ORDER BY variant_row.id
      LIMIT 1
    ) AS anchor_variant ON true$old$;
  v_new := $new$      ORDER BY (variant_row.id = product_row.inventory_anchor_variant_id) DESC NULLS LAST, variant_row.id
      LIMIT 1
    ) AS anchor_variant ON true$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PDP anchor policy source mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$      offer_row.stock_quantity,
      offer_row.images,$old$;
  v_new := $new$      offer_row.stock_quantity,
      CASE inventory.effective_policy
        WHEN 'serialized_strict' THEN LEAST(
          COALESCE(offer_row.stock_quantity,
            CASE WHEN COALESCE(product_row.stock_quantity, 0) = 0 AND COALESCE(product_row.stock, 0) > 0
              THEN product_row.stock ELSE COALESCE(product_row.stock_quantity, product_row.stock, 0) END),
          private.get_serialized_offer_available_units(product_row.merchant_id, product_row.id, offer_row.id, p_branch_id)
        )
        WHEN 'serialized_then_unlimited' THEN offer_row.stock_quantity
        ELSE COALESCE(offer_row.stock_quantity,
          CASE WHEN COALESCE(product_row.stock_quantity, 0) = 0 AND COALESCE(product_row.stock, 0) > 0
            THEN product_row.stock ELSE COALESCE(product_row.stock_quantity, product_row.stock, 0) END)
      END AS allocatable_stock,
      offer_row.images,$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PDP offer projection source mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$    FROM selected_product AS product_row
    JOIN public.product_offers AS offer_row$old$;
  v_new := $new$    FROM selected_product AS product_row
    JOIN simple_inventory_state AS inventory ON inventory.product_id = product_row.id
    JOIN public.product_offers AS offer_row$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PDP offer inventory source mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_old := $old$          'stock_quantity', offer.stock_quantity,
          'images', offer.images,$old$;
  v_new := $new$          'stock_quantity', offer.stock_quantity,
          'allocatable_stock', offer.allocatable_stock,
          'images', offer.images,$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PDP offer JSON source mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$$;
