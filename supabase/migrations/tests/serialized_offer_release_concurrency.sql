-- Deletion before concurrent release must not leave an available unit with
-- an orphaned offer ID. The release waits until the deletion commits.
CREATE EXTENSION IF NOT EXISTS dblink;
\getenv test_db CODEX_OFFER_TEST_DB
\getenv test_host PGHOST
\getenv test_port PGPORT
\getenv test_user PGUSER
\getenv test_password PGPASSWORD
SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
SELECT dblink_connect('delete_offer', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_connect('release_unit', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_exec('release_unit', $$SET application_name='codex_offer_release_race'$$);
SELECT dblink_exec('delete_offer','BEGIN');
SELECT dblink_exec('delete_offer', $$DELETE FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000003'$$);
SELECT dblink_send_query('release_unit', $$UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL WHERE id='00000000-0000-0000-0000-000000000004'$$);
DO $$ BEGIN
 FOR attempt IN 1..100 LOOP
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='codex_offer_release_race' AND wait_event_type='Lock') THEN RETURN; END IF;
  PERFORM pg_sleep(0.02);
 END LOOP;
 RAISE EXCEPTION 'release did not wait for deletion';
END $$;
SELECT dblink_exec('delete_offer','COMMIT');
SELECT * FROM dblink_get_result('release_unit') AS result(status text);
DO $$ BEGIN
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'release/deletion stranded unit'; END IF;
END $$;
SELECT dblink_disconnect('delete_offer');
SELECT dblink_disconnect('release_unit');
