SAVEPOINT managed_stock;
UPDATE public.products SET manage_stock = NULL WHERE slug = 'paged-7';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'the feed advertised units that checkout does not decrement when management is null'; END IF;
END $$;
RESET ROLE;
-- Checkout decrements stock_quantity, so legacy stock cannot replace a missing quantity.
UPDATE public.products SET manage_stock = true, stock_quantity = NULL WHERE slug = 'paged-7';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'the feed inferred tracked units from non-decremented legacy stock'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT managed_stock;
RELEASE SAVEPOINT managed_stock;

SAVEPOINT renamed_published_slug;
UPDATE public.products SET slug = 'renamed-after-activation' WHERE slug = 'paged-7';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'slug change on the last page did not block the pull'; END IF;
END $$;
ROLLBACK TO SAVEPOINT renamed_published_slug;
RELEASE SAVEPOINT renamed_published_slug;

SAVEPOINT offer_hidden_by_parent;
UPDATE public.products SET condition = 'UK-Used' WHERE slug = 'paged-2';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'an offer hidden by the parent condition remained in the active feed'; END IF;
END $$;
ROLLBACK TO SAVEPOINT offer_hidden_by_parent;
RELEASE SAVEPOINT offer_hidden_by_parent;

SAVEPOINT offer_on_serialized_policy;
DO $$
DECLARE policy text;
BEGIN
  FOREACH policy IN ARRAY ARRAY['serialized_strict', 'serialized_then_unlimited'] LOOP
    UPDATE public.products SET inventory_tracking_policy = policy WHERE slug = 'paged-2';
    SET LOCAL ROLE anon;
    IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
    THEN RAISE EXCEPTION 'an active condition offer bypassed % checkout policy', policy; END IF;
    RESET ROLE;
  END LOOP;
END $$;
ROLLBACK TO SAVEPOINT offer_on_serialized_policy;
RELEASE SAVEPOINT offer_on_serialized_policy;

SAVEPOINT stock_drop;
UPDATE public.products SET stock_quantity = 2, stock = 2 WHERE slug = 'paged-7';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'tracked stock decrease on the last page did not block the pull'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT stock_drop;
RELEASE SAVEPOINT stock_drop;
SAVEPOINT publish_variant;
UPDATE public.products SET inventory_anchor_variant_id = NULL WHERE slug = 'paged-1';
INSERT INTO public.product_variants (
  id, merchant_id, product_id, condition, attributes, is_inventory_anchor,
  stock_quantity, inventory_tracking_policy
) VALUES (
  '42000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001', 'new', '{"storage":"256GB"}'::jsonb, false, 12, 'inherit'
);
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'a parent with a public variant was still served as a simple listing'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT publish_variant;
RELEASE SAVEPOINT publish_variant;
UPDATE public.products SET status = 'draft' WHERE slug = 'paged-7';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('p', 43), 1, 3, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'last-page withdrawal did not block the first page'; END IF;
END $$;
RESET ROLE;
