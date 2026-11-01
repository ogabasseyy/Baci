-- Separate assigned condition units from the ordinary serialized pool and
-- count each strict offer against its own units. Checkout remains gated.
CREATE OR REPLACE FUNCTION pg_temp.patch_serialized_availability(signature text, old text, replacement text, expected integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text := pg_catalog.pg_get_functiondef(signature::regprocedure);
BEGIN
  IF old = '' OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> expected THEN
    RAISE EXCEPTION 'serialized availability source mismatch: %', signature;
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$$;

SELECT pg_temp.patch_serialized_availability(
  'private.get_public_serialized_variant_availability_counts(uuid,uuid[],uuid)',
  $old$      AND vi.status = 'available'$old$,
  $new$      AND vi.condition_offer_id IS NULL
      AND vi.status = 'available'$new$
);

SELECT pg_temp.patch_serialized_availability(
  'public.get_storefront_offer_resolution(uuid,uuid[])',
  $old$    SELECT s.product_id, s.public_available_units
    FROM merchant_slices AS ms
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(
      ms.merchant_id, ms.ids
    ) AS s
    WHERE s.variant_id IS NULL$old$,
  $new$    SELECT r.id AS product_id, o.id AS offer_id, count(vi.id)::integer AS public_available_units
    FROM requested AS r
    JOIN anchor_policy AS a ON a.product_id = r.id AND a.effective_policy = 'serialized_strict'
    JOIN public.product_offers AS o ON o.product_id = r.id AND o.merchant_id = r.merchant_id
    JOIN public.product_variants AS pv ON pv.product_id = r.id AND pv.merchant_id = r.merchant_id
      AND pv.is_inventory_anchor IS TRUE
    JOIN public.variant_inventory AS vi ON vi.variant_id = pv.id AND vi.merchant_id = r.merchant_id
      AND vi.condition_offer_id = o.id AND vi.status = 'available'
      AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS active_count, (array_agg(b.id))[1] AS only_branch_id
      FROM public.branches AS b WHERE b.merchant_id = r.merchant_id AND b.active IS TRUE
    ) AS branch_scope
    WHERE vi.branch_id IS NULL
      OR (branch_scope.active_count = 1 AND vi.branch_id = branch_scope.only_branch_id)
    GROUP BY r.id, o.id$new$
);
SELECT pg_temp.patch_serialized_availability(
  'public.get_storefront_offer_resolution(uuid,uuid[])',
  $old$  LEFT JOIN serialized AS s ON s.product_id = r.id$old$,
  $new$  LEFT JOIN serialized AS s ON s.product_id = r.id AND s.offer_id = o.id$new$
);

-- Prefer the actual product anchor when stale extra anchor rows exist, as
-- assignment and reservation both bind to the designated anchor.
SELECT pg_temp.patch_serialized_availability(
  'public.get_storefront_offer_resolution(uuid,uuid[])',
  $old$         ORDER BY av.id LIMIT 1),$old$,
  $new$         ORDER BY (av.id = (SELECT p.inventory_anchor_variant_id FROM public.products AS p
           WHERE p.id = r.id AND p.merchant_id = r.merchant_id)) DESC NULLS LAST, av.id LIMIT 1),$new$
);
