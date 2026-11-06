-- Pin the current public catalog display name into a reviewed checkout
-- snapshot. Names are bounded and sourced only from the same merchant-owned
-- product row already used to validate the line.
DO $patch$
DECLARE
  definition text;
  old text;
  replacement text;
  original_count integer;
  all_original boolean;
  all_patched boolean;
BEGIN
  definition := pg_get_functiondef(
    'public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure
  );

  all_original :=
    (length(definition) - length(replace(definition, $source$      l.product_id AS product_id,
      l.variant_id AS variant_id,$source$, ''))) / length($source$      l.product_id AS product_id,
      l.variant_id AS variant_id,$source$) = 1
    AND (length(definition) - length(replace(definition, $enriched$      line_created,
      product_id,
      variant_id,$enriched$, ''))) / length($enriched$      line_created,
      product_id,
      variant_id,$enriched$) = 1
    AND (length(definition) - length(replace(definition, $output$        'productId', product_id,
        'variantId', variant_id,$output$, ''))) / length($output$        'productId', product_id,
        'variantId', variant_id,$output$) = 1;
  all_original := all_original
    AND position($source$      l.product_id AS product_id,
      CASE WHEN p.merchant_id = p_merchant_id
        THEN left(nullif(btrim(p.name), ''), 200)
        ELSE NULL
      END AS product_name,
      l.variant_id AS variant_id,$source$ IN definition) = 0
    AND position($enriched$      line_created,
      product_id,
      product_name,
      variant_id,$enriched$ IN definition) = 0
    AND position($output$        'productId', product_id,
        'productName', product_name,
        'variantId', variant_id,$output$ IN definition) = 0;
  all_patched :=
    (length(definition) - length(replace(definition, $source$      l.product_id AS product_id,
      CASE WHEN p.merchant_id = p_merchant_id
        THEN left(nullif(btrim(p.name), ''), 200)
        ELSE NULL
      END AS product_name,
      l.variant_id AS variant_id,$source$, ''))) / length($source$      l.product_id AS product_id,
      CASE WHEN p.merchant_id = p_merchant_id
        THEN left(nullif(btrim(p.name), ''), 200)
        ELSE NULL
      END AS product_name,
      l.variant_id AS variant_id,$source$) = 1
    AND (length(definition) - length(replace(definition, $enriched$      line_created,
      product_id,
      product_name,
      variant_id,$enriched$, ''))) / length($enriched$      line_created,
      product_id,
      product_name,
      variant_id,$enriched$) = 1
    AND (length(definition) - length(replace(definition, $output$        'productId', product_id,
        'productName', product_name,
        'variantId', variant_id,$output$, ''))) / length($output$        'productId', product_id,
        'productName', product_name,
        'variantId', variant_id,$output$) = 1
    AND position($source$      l.product_id AS product_id,
      l.variant_id AS variant_id,$source$ IN definition) = 0
    AND position($enriched$      line_created,
      product_id,
      variant_id,$enriched$ IN definition) = 0
    AND position($output$        'productId', product_id,
        'variantId', variant_id,$output$ IN definition) = 0;
  IF all_patched THEN
    RETURN;
  ELSIF NOT all_original THEN
    RAISE EXCEPTION 'checkout snapshot product name patch is partial or ambiguous';
  END IF;

  old := $old$      l.product_id AS product_id,
      l.variant_id AS variant_id,$old$;
  replacement := $new$      l.product_id AS product_id,
      CASE WHEN p.merchant_id = p_merchant_id
        THEN left(nullif(btrim(p.name), ''), 200)
        ELSE NULL
      END AS product_name,
      l.variant_id AS variant_id,$new$;
  original_count := (length(definition) - length(replace(definition, old, ''))) / length(old);
  IF original_count <> 1 THEN
    RAISE EXCEPTION 'checkout snapshot product name source patch state mismatch';
  END IF;
  definition := replace(definition, old, replacement);

  old := $old$      line_created,
      product_id,
      variant_id,$old$;
  replacement := $new$      line_created,
      product_id,
      product_name,
      variant_id,$new$;
  original_count := (length(definition) - length(replace(definition, old, ''))) / length(old);
  IF original_count <> 1 THEN
    RAISE EXCEPTION 'checkout snapshot product name enrichment patch state mismatch';
  END IF;
  definition := replace(definition, old, replacement);

  old := $old$        'productId', product_id,
        'variantId', variant_id,$old$;
  replacement := $new$        'productId', product_id,
        'productName', product_name,
        'variantId', variant_id,$new$;
  original_count := (length(definition) - length(replace(definition, old, ''))) / length(old);
  IF original_count <> 1 THEN
    RAISE EXCEPTION 'checkout snapshot product name output patch state mismatch';
  END IF;
  definition := replace(definition, old, replacement);

  EXECUTE definition;
END
$patch$;
