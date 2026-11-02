-- The listing is also the source for the unit edit form. Omitting notes
-- silently turns an unchanged save into deletion of existing notes.
DO $$
DECLARE
  response jsonb;
  first_row jsonb;
BEGIN
  response := private.list_variant_inventory_units(
    '00000000-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );
  first_row := response->'rows'->0;
  ASSERT first_row->>'merchant_id' = '00000000-0000-0000-0000-000000000003',
    'listing must return the owning merchant';
  ASSERT first_row->>'notes' = 'keep this note',
    'listing must preserve notes for the edit form';
END $$;
