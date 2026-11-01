INSERT INTO private.legacy_offer_cleanup_reservations (order_item_id,reservation_event_id) SELECT order_item_id,id FROM private.variant_inventory_events WHERE event_type='reserved' AND NOT (event_context ? 'later');
DO $$ BEGIN
 IF has_table_privilege('anon','private.legacy_offer_cleanup_reservations','SELECT')
 OR has_table_privilege('authenticated','private.legacy_offer_cleanup_reservations','SELECT')
 OR has_table_privilege('service_role','private.legacy_offer_cleanup_reservations','SELECT') THEN
  RAISE EXCEPTION 'cleanup evidence must not be exposed to API roles';
 END IF;
 IF private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001') IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'cleaned legacy offer must route through quantity stock';
 END IF;
 IF private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002') IS DISTINCT FROM true
 OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003') IS DISTINCT FROM true
 OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004') IS DISTINCT FROM true
 OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005') IS DISTINCT FROM true
 OR private.redvault_line_was_serialized('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000006') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'plain or sold lines must retain serialized routing';
 END IF;
END $$;
