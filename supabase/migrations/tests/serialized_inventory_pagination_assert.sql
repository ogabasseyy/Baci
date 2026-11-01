-- The fixture has three units in descending ID/time order. The second case
-- ties their timestamps so the ID tiebreaker is exercised as well.
DO $$
DECLARE
  first_page jsonb;
  second_page jsonb;
  cursor_value jsonb;
  test_case integer;
BEGIN
  FOR test_case IN 1..2 LOOP
    IF test_case = 2 THEN
      UPDATE public.variant_inventory SET created_at = '2026-01-01'::timestamptz;
    END IF;

    first_page := private.list_variant_inventory_units(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001', p_limit => 2
    );
    cursor_value := first_page->'nextCursor';
    IF jsonb_array_length(first_page->'rows') <> 2
      OR NOT (first_page->>'hasMore')::boolean
      OR cursor_value->>'id' <> '00000000-0000-0000-0000-000000000002' THEN
      RAISE EXCEPTION 'first page cursor must identify its last returned unit';
    END IF;

    second_page := private.list_variant_inventory_units(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001', p_limit => 2,
      p_cursor_created_at => (cursor_value->>'createdAt')::timestamptz,
      p_cursor_id => (cursor_value->>'id')::uuid
    );
    IF jsonb_array_length(second_page->'rows') <> 1
      OR second_page->'rows'->0->>'id' <> '00000000-0000-0000-0000-000000000001'
      OR (second_page->>'hasMore')::boolean
      OR second_page->'nextCursor' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'second page must include the lookahead unit and end';
    END IF;
  END LOOP;
END $$;
