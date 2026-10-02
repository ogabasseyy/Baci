-- Public variant eligibility stays in parity across recall, browse, condition
-- matching, and bounded hydration, including legacy NULL-managed parents.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  ('cb58d110-0000-4000-8000-000000000811', 'variant-projection@example.test',
   'Variant Projection', 'variant-projection', true),
  ('cb58d110-0000-4000-8000-000000000812', 'unpublished-projection@example.test',
   'Unpublished Projection', 'unpublished-projection', false);

INSERT INTO public.branches (id, merchant_id, name, active)
VALUES
  ('cb58d110-0000-4000-8000-000000000821',
   'cb58d110-0000-4000-8000-000000000811', 'Public Branch', true),
  ('cb58d110-0000-4000-8000-000000000822',
   'cb58d110-0000-4000-8000-000000000811', 'Inactive Branch', false);

INSERT INTO public.products
  (id, merchant_id, name, slug, price, stock_quantity, status, has_variants, manage_stock,
   inventory_tracking_policy)
VALUES
  ('cb58d110-0000-4000-8000-000000000831', 'cb58d110-0000-4000-8000-000000000811',
   'Null managed parent', 'null-managed-parent', 100, 4, 'active', true, NULL, 'off'),
  ('cb58d110-0000-4000-8000-000000000832', 'cb58d110-0000-4000-8000-000000000812',
   'Unpublished parent', 'unpublished-parent', 100, 4, 'active', true, true, 'off');

INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, inventory_tracking_policy,
   is_inventory_anchor)
VALUES
  ('cb58d110-0000-4000-8000-000000000841', 'cb58d110-0000-4000-8000-000000000831',
   'cb58d110-0000-4000-8000-000000000811', '{"size":"zero"}', 0, 'inherit', false),
  ('cb58d110-0000-4000-8000-000000000842', 'cb58d110-0000-4000-8000-000000000831',
   'cb58d110-0000-4000-8000-000000000811', '{"size":"stocked"}', 1, 'inherit', false),
  ('cb58d110-0000-4000-8000-000000000843', 'cb58d110-0000-4000-8000-000000000831',
   'cb58d110-0000-4000-8000-000000000811', '{"size":"serialized"}', 0, 'serialized_strict', false),
  ('cb58d110-0000-4000-8000-000000000844', 'cb58d110-0000-4000-8000-000000000831',
   'cb58d110-0000-4000-8000-000000000811', '{"anchor":true}', 9, 'serialized_strict', true),
  ('cb58d110-0000-4000-8000-000000000845', 'cb58d110-0000-4000-8000-000000000832',
   'cb58d110-0000-4000-8000-000000000812', '{"size":"private"}', 8, 'off', false),
  ('cb58d110-0000-4000-8000-000000000846', 'cb58d110-0000-4000-8000-000000000831',
   'cb58d110-0000-4000-8000-000000000812', '{"size":"foreign"}', 8, 'off', false);

INSERT INTO public.variant_inventory
  (id, merchant_id, variant_id, branch_id, identifier_type, identifier_value, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000851', 'cb58d110-0000-4000-8000-000000000811',
   'cb58d110-0000-4000-8000-000000000843', 'cb58d110-0000-4000-8000-000000000821',
   'serial', 'branch-unit', 'available'),
  ('cb58d110-0000-4000-8000-000000000852', 'cb58d110-0000-4000-8000-000000000811',
   'cb58d110-0000-4000-8000-000000000843', NULL, 'serial', 'unassigned-unit', 'available'),
  ('cb58d110-0000-4000-8000-000000000853', 'cb58d110-0000-4000-8000-000000000811',
   'cb58d110-0000-4000-8000-000000000843', 'cb58d110-0000-4000-8000-000000000822',
   'serial', 'other-branch-unit', 'available');

-- The helper is deliberately private even to app roles. Run its unit
-- assertions as the migration-test connection owner before public RPC checks.
RESET ROLE;

DO $$
DECLARE
  v_zero_purchasable boolean;
  v_stocked_purchasable boolean;
  v_serialized_units integer;
  v_projection_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'discovery.public_variant_option_projection(uuid,uuid[])'::regprocedure)
  INTO v_projection_definition;
  IF pg_catalog.strpos(v_projection_definition,
      'JOIN public_variants AS v ON v.id = vi.variant_id') = 0 THEN
    RAISE EXCEPTION 'serialized inventory aggregation must be narrowed to the requested public variant set';
  END IF;
  IF pg_catalog.strpos(v_projection_definition,
      'COALESCE(r.stored_stock, r.parent_stock)') = 0 THEN
    RAISE EXCEPTION 'a nullable child stock value must inherit the managed parent stock';
  END IF;

  SELECT is_purchasable INTO v_zero_purchasable
  FROM discovery.public_variant_option_projection(
    'cb58d110-0000-4000-8000-000000000811',
    ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid])
  WHERE variant_id = 'cb58d110-0000-4000-8000-000000000841';
  IF v_zero_purchasable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'zero-stock inherited off variant under NULL-managed parent must remain unavailable';
  END IF;

  SELECT is_purchasable INTO v_stocked_purchasable
  FROM discovery.public_variant_option_projection(
    'cb58d110-0000-4000-8000-000000000811',
    ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid])
  WHERE variant_id = 'cb58d110-0000-4000-8000-000000000842';
  IF v_stocked_purchasable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'stocked inherited off variant under NULL-managed parent must be purchasable';
  END IF;

  SELECT available_units INTO v_serialized_units
  FROM discovery.public_variant_option_projection(
    'cb58d110-0000-4000-8000-000000000811',
    ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid])
  WHERE variant_id = 'cb58d110-0000-4000-8000-000000000843';
  IF v_serialized_units IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'one active branch should expose its own plus unassigned serialized units; got %', v_serialized_units;
  END IF;

  IF EXISTS (SELECT 1 FROM discovery.public_variant_option_projection(
       'cb58d110-0000-4000-8000-000000000811',
       ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid])
       WHERE variant_id IN ('cb58d110-0000-4000-8000-000000000844',
         'cb58d110-0000-4000-8000-000000000845',
         'cb58d110-0000-4000-8000-000000000846')) THEN
    RAISE EXCEPTION 'projection exposed an anchor, unpublished option, or cross-merchant variant';
  END IF;
END;
$$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  hydrated_ids uuid[];
  browse_ids uuid[];
  recall_ids uuid[];
BEGIN
  IF pg_catalog.has_function_privilege('anon',
      'discovery.public_variant_option_projection(uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'canonical projection must remain private';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO hydrated_ids
  FROM public.get_mcp_search_product_variants(
    ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid,
      'cb58d110-0000-4000-8000-000000000832'::uuid],
    'cb58d110-0000-4000-8000-000000000811');
  IF hydrated_ids IS DISTINCT FROM ARRAY[
      'cb58d110-0000-4000-8000-000000000841'::uuid,
      'cb58d110-0000-4000-8000-000000000842'::uuid,
      'cb58d110-0000-4000-8000-000000000843'::uuid] THEN
    RAISE EXCEPTION 'bounded hydration diverged from public projection: %', hydrated_ids;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO browse_ids
  FROM public.search_products_browse(
    'cb58d110-0000-4000-8000-000000000811', NULL, NULL, NULL, 10, 0, NULL, '[]'::jsonb);
  IF browse_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid] THEN
    RAISE EXCEPTION 'browse did not consume the shared public option projection: %', browse_ids;
  END IF;

  SELECT array_agg(product_id ORDER BY product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000811', '[]'::jsonb, 10, 0);
  IF recall_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000831'::uuid] THEN
    RAISE EXCEPTION 'recall did not consume the shared public option projection: %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;
