-- Preserve exact offer identity across every cart writer and checkout binding.
-- Source-shape assertions fail closed if an earlier authority changed.
CREATE OR REPLACE FUNCTION public.commerce_cart_parse_offer_id(p_line jsonb)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_item jsonb;
  v_text text;
BEGIN
  IF jsonb_typeof(p_line) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_item := p_line -> 'item';
  IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (v_item ? 'offerId') OR jsonb_typeof(v_item -> 'offerId') = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_item -> 'offerId') <> 'string'
    OR nullif(v_item ->> 'variantId', '') IS NOT NULL
    OR nullif(p_line ->> 'voucherToken', '') IS NOT NULL
    OR nullif(p_line ->> 'voucherAwardId', '') IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_text := v_item ->> 'offerId';
  IF v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_text::uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_parse_offer_id(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.patch_cart_exact_offer_review(
  signature text, old text, replacement text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(signature::regprocedure);
  found integer;
BEGIN
  IF old = '' THEN RAISE EXCEPTION 'empty exact offer review anchor'; END IF;
  found := (length(definition) - length(replace(definition,old,''))) / length(old);
  IF found <> 1 THEN
    RAISE EXCEPTION 'exact offer review source mismatch for % expected 1 found %',signature,found;
  END IF;
  EXECUTE replace(definition,old,replacement);
END;
$$;

-- An ID-only line resolves its condition from the same live offer it reviews.
SELECT pg_temp.patch_cart_exact_offer_review(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$      l.condition AS condition,$old$,
  $new$      CASE WHEN l.offer_id IS NOT NULL
        THEN coalesce(l.condition, discovery.canonical_product_condition(offer.condition))
        ELSE l.condition END AS condition,$new$
);

-- Never silently convert an inactive/deleted exact offer to a parent line.
-- Also refuse incompatible historical rows, even if an older writer accepted them.
SELECT pg_temp.patch_cart_exact_offer_review(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$) AND public.commerce_cart_condition_supported(p_merchant_id,l.product_id,l.variant_id,l.condition) AS offer_ok,$old$,
  $new$) AND (
        (l.offer_id IS NULL AND public.commerce_cart_condition_supported(p_merchant_id,l.product_id,l.variant_id,l.condition))
        OR (l.offer_id IS NOT NULL AND offer.id IS NOT NULL
          AND l.variant_id IS NULL AND l.voucher_token IS NULL AND l.voucher_award_id IS NULL
          AND public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,l.product_id)
          AND (l.condition IS NULL OR l.condition = discovery.canonical_product_condition(offer.condition))
          AND EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id
            AND (coalesce(m.is_published,false) OR coalesce(m.is_platform_admin,false))))
      ) AS offer_ok,$new$
);

-- Agentic callers derive purchase identity from the review, including offer ID.
SELECT pg_temp.patch_cart_exact_offer_review(
  'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)',
  $old$          'variant_id', s.sl -> 'variantId',$old$,
  $new$          'variant_id', s.sl -> 'variantId',
          'offer_id', s.sl -> 'offerId',$new$
);

-- Caller-supplied display metadata may only match the same reviewed offer.
SELECT pg_temp.patch_cart_exact_offer_review(
  'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)',
  $old$          AND nullif(i.item ->> 'condition', '')$old$,
  $new$          AND nullif(lower(i.item ->> 'offer_id'), '')
            IS NOT DISTINCT FROM (s.sl ->> 'offerId')
          AND nullif(i.item ->> 'condition', '')$new$
);

-- Shopper echoes must match the reviewed exact ID and resolved condition.
SELECT pg_temp.patch_cart_exact_offer_review(
  'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)',
  $old$            AND nullif(item ->> 'condition', '') IS NOT DISTINCT FROM l.condition$old$,
  $new$            AND nullif(lower(item ->> 'offer_id'), '') IS NOT DISTINCT FROM l.offer_id::text
            AND nullif(item ->> 'condition', '') IS NOT DISTINCT FROM (
              SELECT sl ->> 'condition'
              FROM jsonb_array_elements(coalesce(v_snapshot -> 'lines','[]'::jsonb)) sl
              WHERE sl ->> 'id' = l.id::text
            )$new$
);
