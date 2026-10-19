-- Offer identity must survive both storefront order entry points.
-- Migration 20261008300000 patches only one candidate function (LIMIT 1,
-- preferring create_storefront_order_unchecked) to stage and insert
-- order_items.offer_id. That is safe only while the sibling either carries
-- the same staging or delegates p_items untouched. A future append-only
-- migration that re-creates either function from a pre-offer definition
-- would silently persist offer_id = NULL, so pin the invariant here.
DO $$ DECLARE
  v_unchecked_def text;
  v_checked_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_unchecked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24;
  IF v_unchecked_def IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order_unchecked(24) not found';
  END IF;
  IF strpos(lower(v_unchecked_def), 'offer_id') = 0 THEN
    RAISE EXCEPTION 'unchecked order entry point lost its offer_id staging';
  END IF;
  -- The line-integrity patch stages the live offer condition beside the id;
  -- without it, lines would store a stale submitted condition on live rows.
  IF strpos(v_unchecked_def, 'offer_condition TEXT') = 0 THEN
    RAISE EXCEPTION 'unchecked order entry point lost its offer_condition staging';
  END IF;
  -- The label-snapshot patch freezes the purchased offer's grade and
  -- condition notes beside offer_id; without it, historical lines
  -- resolve live labels that later merchant edits rewrite. The marker
  -- patch records that the snapshot ran, so stored NULL labels read
  -- as creation-time truth rather than missing data. Both entry
  -- points funnel through the unchecked definition (checked must
  -- delegate, pinned below), so asserting the markers here covers
  -- both paths.
  IF strpos(lower(v_unchecked_def), 'offer_grade') = 0 THEN
    RAISE EXCEPTION 'unchecked order entry point lost its offer_grade snapshot';
  END IF;
  IF strpos(lower(v_unchecked_def), 'offer_condition_notes') = 0 THEN
    RAISE EXCEPTION 'unchecked order entry point lost its offer_condition_notes snapshot';
  END IF;
  IF strpos(lower(v_unchecked_def), 'offer_labels_snapshotted') = 0 THEN
    RAISE EXCEPTION 'unchecked order entry point lost its offer_labels_snapshotted marker';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_checked_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order'
    AND p.pronargs = 24;
  IF v_checked_def IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order(24) not found';
  END IF;
  -- The checked entry point must delegate (p_items untouched) rather than
  -- insert order lines itself; otherwise its path drops offer identity.
  IF strpos(v_checked_def, 'create_storefront_order_unchecked(') = 0 THEN
    RAISE EXCEPTION 'checked order entry point no longer delegates to unchecked';
  END IF;
  IF v_checked_def ~* 'insert\s+into[^;]*order_items' THEN
    RAISE EXCEPTION 'checked order entry point inserts order lines itself';
  END IF;
END $$;
