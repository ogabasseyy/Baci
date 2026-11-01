-- A merchant assignment racing a reservation release must not deadlock on
-- the unit and offer. SHARE and KEY SHARE are deliberately compatible.
CREATE EXTENSION IF NOT EXISTS dblink;
\getenv test_db CODEX_OFFER_TEST_DB
\getenv test_host PGHOST
\getenv test_port PGPORT
\getenv test_user PGUSER
\getenv test_password PGPASSWORD
SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
UPDATE public.variant_inventory SET status='reserved',order_id='00000000-0000-0000-0000-000000000008',order_item_id='00000000-0000-0000-0000-000000000009' WHERE id='00000000-0000-0000-0000-000000000004';
SELECT dblink_connect('assigner', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_connect('releaser', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_exec('assigner', $$SET application_name='codex_offer_assignment_race'$$);
SELECT dblink_exec('assigner', $$SET test.role='authenticated'$$);
SELECT dblink_exec('assigner', $$SET test.merchant='00000000-0000-0000-0000-000000000010'$$);
SELECT dblink_exec('releaser','BEGIN');
SELECT * FROM dblink('releaser', $$SELECT id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004' FOR UPDATE$$) AS locked(id uuid);
SELECT dblink_send_query('assigner', $$SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003')$$);
DO $$ BEGIN
 FOR attempt IN 1..100 LOOP
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='codex_offer_assignment_race' AND wait_event_type='Lock') THEN RETURN; END IF;
  PERFORM pg_sleep(0.02);
 END LOOP;
 RAISE EXCEPTION 'assignment did not wait for the unit';
END $$;
SELECT dblink_exec('releaser', $$UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL WHERE id='00000000-0000-0000-0000-000000000004'$$);
SELECT dblink_exec('releaser','COMMIT');
CREATE TEMP TABLE assignment_race_result AS SELECT result FROM dblink_get_result('assigner') AS assigned(result jsonb);
DO $$ BEGIN
 IF (SELECT count(*) FROM assignment_race_result WHERE result->>'offerId'='00000000-0000-0000-0000-000000000003') <> 1 THEN RAISE EXCEPTION 'concurrent assignment did not complete'; END IF;
END $$;
SELECT dblink_disconnect('assigner');
SELECT dblink_disconnect('releaser');
UPDATE public.variant_inventory SET condition_offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000004';
