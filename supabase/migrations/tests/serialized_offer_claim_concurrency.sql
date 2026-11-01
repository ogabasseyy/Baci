-- Reproduce the product/unit inversion with independent database sessions.
-- The assignment transaction holds the product before updating a unit; the
-- production stock-sync path takes the product lock after a unit status update.
CREATE OR REPLACE FUNCTION private.sync_serialized_stock(p_merchant_id uuid, p_product_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.products SET stock = stock WHERE id = p_product_id AND merchant_id = p_merchant_id;
END;
$$;
\getenv test_db CODEX_OFFER_TEST_DB
\getenv test_host PGHOST
\getenv test_port PGPORT
\getenv test_user PGUSER
\getenv test_password PGPASSWORD
SELECT dblink_connect('assigner', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_connect('claimer', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'));
SELECT dblink_exec('claimer', $$SET application_name = 'codex_offer_claim_race'$$);
SELECT dblink_exec('assigner', 'BEGIN');
SELECT dblink_exec('assigner', $$UPDATE public.products SET stock=stock WHERE id='00000000-0000-0000-0000-000000000001'$$);
SELECT dblink_send_query('claimer', $$SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006')$$);
DO $$
BEGIN
  FOR attempt IN 1..100 LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = current_database()
      AND application_name = 'codex_offer_claim_race' AND wait_event_type = 'Lock') THEN
      RETURN;
    END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
  RAISE EXCEPTION 'claim did not reach the product lock';
END;
$$;
SELECT dblink_exec('assigner', $$UPDATE public.variant_inventory SET condition_offer_id='00000000-0000-0000-0000-000000000003' WHERE id='00000000-0000-0000-0000-000000000008'$$);
SELECT dblink_exec('assigner', 'COMMIT');
CREATE TEMP TABLE claim_race_result AS SELECT result FROM dblink_get_result('claimer') AS claimed(result jsonb);
DO $$ BEGIN
 IF (SELECT count(*) FROM claim_race_result WHERE (result->>'missingUnitCount')::integer = 0) <> 1 THEN
   RAISE EXCEPTION 'concurrent claim did not complete';
 END IF;
END $$;
SELECT dblink_disconnect('assigner');
SELECT dblink_disconnect('claimer');
