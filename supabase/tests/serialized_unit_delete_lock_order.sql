-- A deleter must wait for the product before taking the variant/unit locks.
CREATE TABLE private.variant_inventory_events (inventory_unit_id uuid, event_type text);
CREATE OR REPLACE FUNCTION private.sync_serialized_stock(p_merchant_id uuid, p_product_id uuid)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE public.products SET updated_at = clock_timestamp()
  WHERE id = p_product_id AND merchant_id = p_merchant_id;
END $$;
INSERT INTO public.products (id, merchant_id) VALUES
 ('00000000-0000-4000-8000-00000000fe01', '00000000-0000-4000-8000-00000000fe02');
INSERT INTO public.product_variants (id, product_id) VALUES
 ('00000000-0000-4000-8000-00000000fe03', '00000000-0000-4000-8000-00000000fe01');
INSERT INTO public.variant_inventory (id, variant_id, merchant_id, status) VALUES
 ('00000000-0000-4000-8000-00000000fe04', '00000000-0000-4000-8000-00000000fe03', '00000000-0000-4000-8000-00000000fe02', 'available');
SELECT dblink_connect('holder', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_connect('deleter', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_exec('holder', 'BEGIN');
SELECT dblink_exec('deleter', $$SET application_name = 'serialized_unit_deleter'$$);
SELECT dblink_exec('deleter', $$SET statement_timeout = '5000ms'$$);
SELECT * FROM dblink('holder', $$SELECT id FROM public.products WHERE id = '00000000-0000-4000-8000-00000000fe01' FOR UPDATE$$) AS t(id uuid);
SELECT dblink_send_query('deleter', $$SELECT private.delete_variant_inventory_unit('00000000-0000-4000-8000-00000000fe02', '00000000-0000-4000-8000-00000000fe04')$$);
DO $$ DECLARE waiting boolean := false; BEGIN
  FOR i IN 1..100 LOOP
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'serialized_unit_deleter' AND wait_event_type = 'Lock') INTO waiting;
    EXIT WHEN waiting;
    PERFORM pg_sleep(0.05);
  END LOOP;
  ASSERT waiting, 'deleter must wait for the product lock';
END $$;
SELECT * FROM dblink('holder', $$SELECT id FROM public.product_variants WHERE id = '00000000-0000-4000-8000-00000000fe03' FOR UPDATE NOWAIT$$) AS t(id uuid);
SELECT * FROM dblink('holder', $$SELECT id FROM public.variant_inventory WHERE id = '00000000-0000-4000-8000-00000000fe04' FOR UPDATE NOWAIT$$) AS t(id uuid);
SELECT dblink_exec('holder', 'COMMIT');
SELECT * FROM dblink_get_result('deleter') AS t(result jsonb);
DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id = '00000000-0000-4000-8000-00000000fe04'), 'successful deletion must remove the unit'; END $$;
SELECT dblink_disconnect('holder');
SELECT dblink_disconnect('deleter');
