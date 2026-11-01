-- Cancellation must not take a unit lock while waiting for its product.
CREATE OR REPLACE FUNCTION private.sync_serialized_stock(p_merchant_id uuid, p_product_id uuid)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE public.products SET updated_at = clock_timestamp()
  WHERE id = p_product_id AND merchant_id = p_merchant_id;
END $$;
INSERT INTO public.products (id, merchant_id) VALUES ('00000000-0000-4000-8000-00000000fd01', '00000000-0000-4000-8000-00000000fd02');
INSERT INTO public.product_variants (id, product_id) VALUES ('00000000-0000-4000-8000-00000000fd03', '00000000-0000-4000-8000-00000000fd01');
INSERT INTO public.orders (id, merchant_id) VALUES ('00000000-0000-4000-8000-00000000fd04', '00000000-0000-4000-8000-00000000fd02');
INSERT INTO public.order_items (id, order_id, product_id, variant_id, quantity) VALUES ('00000000-0000-4000-8000-00000000fd05', '00000000-0000-4000-8000-00000000fd04', '00000000-0000-4000-8000-00000000fd01', '00000000-0000-4000-8000-00000000fd03', 1);
INSERT INTO public.variant_inventory (id, variant_id, order_id, order_item_id, merchant_id, status) VALUES ('00000000-0000-4000-8000-00000000fd06', '00000000-0000-4000-8000-00000000fd03', '00000000-0000-4000-8000-00000000fd04', '00000000-0000-4000-8000-00000000fd05', '00000000-0000-4000-8000-00000000fd02', 'reserved');
INSERT INTO public.products (id, merchant_id) VALUES ('00000000-0000-4000-8000-00000000fd10', '00000000-0000-4000-8000-00000000fd02');
INSERT INTO public.product_variants (id, product_id) VALUES ('00000000-0000-4000-8000-00000000fd11', '00000000-0000-4000-8000-00000000fd10');
INSERT INTO public.order_items (id, order_id, product_id, variant_id, quantity) VALUES ('00000000-0000-4000-8000-00000000fd12', '00000000-0000-4000-8000-00000000fd04', '00000000-0000-4000-8000-00000000fd10', '00000000-0000-4000-8000-00000000fd11', 1);
INSERT INTO public.variant_inventory (id, variant_id, order_id, order_item_id, merchant_id, status) VALUES ('00000000-0000-4000-8000-00000000fd13', '00000000-0000-4000-8000-00000000fd11', '00000000-0000-4000-8000-00000000fd04', '00000000-0000-4000-8000-00000000fd12', '00000000-0000-4000-8000-00000000fd02', 'reserved');
SELECT set_config('test.release_target', :'target_status', false);
SELECT dblink_connect('holder', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_connect('releaser', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_exec('holder', 'BEGIN');
SELECT dblink_exec('releaser', $$SET application_name = 'serialized_unit_releaser'$$);
SELECT dblink_exec('releaser', $$SET statement_timeout = '5000ms'$$);
SELECT * FROM dblink('holder', $$SELECT id FROM public.products WHERE id = '00000000-0000-4000-8000-00000000fd10' FOR UPDATE$$) AS t(id uuid);
SELECT dblink_send_query('releaser', format($query$SELECT private.release_order_inventory_units('00000000-0000-4000-8000-00000000fd02', '00000000-0000-4000-8000-00000000fd04', %L)$query$, current_setting('test.release_target')));
DO $$ DECLARE waiting boolean := false; BEGIN
  FOR i IN 1..100 LOOP
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'serialized_unit_releaser' AND wait_event_type = 'Lock') INTO waiting;
    EXIT WHEN waiting;
    PERFORM pg_sleep(0.05);
  END LOOP;
  ASSERT waiting, 'release must wait for the product lock';
END $$;
SELECT * FROM dblink('holder', $$SELECT id FROM public.variant_inventory WHERE id = '00000000-0000-4000-8000-00000000fd06' FOR UPDATE NOWAIT$$) AS t(id uuid);
SELECT dblink_exec('holder', 'COMMIT');
SELECT * FROM dblink_get_result('releaser') AS t(result jsonb);
DO $$ BEGIN ASSERT (SELECT bool_and(status = current_setting('test.release_target')) FROM public.variant_inventory WHERE id IN ('00000000-0000-4000-8000-00000000fd06', '00000000-0000-4000-8000-00000000fd13')), 'reservations must reach target status'; END $$;
SELECT dblink_disconnect('holder');
SELECT dblink_disconnect('releaser');
