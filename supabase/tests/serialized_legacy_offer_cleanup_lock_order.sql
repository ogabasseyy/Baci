-- An offer cleanup may encounter several products; lock them before units.
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, touched_at timestamptz DEFAULT now());
INSERT INTO public.products (id, merchant_id) VALUES
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006'),
 ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000006');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000008');
INSERT INTO public.variant_inventory (id, variant_id, merchant_id, order_id, order_item_id, status) VALUES
 ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'reserved');
CREATE FUNCTION private.test_sync_offer_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  UPDATE public.products p SET touched_at = clock_timestamp()
  FROM public.product_variants pv WHERE pv.id = NEW.variant_id AND p.id = pv.product_id AND p.merchant_id = NEW.merchant_id;
  RETURN NEW;
END $$;
CREATE TRIGGER test_sync_offer_product AFTER UPDATE OF status ON public.variant_inventory FOR EACH ROW EXECUTE FUNCTION private.test_sync_offer_product();
SELECT dblink_connect('holder', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_connect('cleanup', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_exec('holder', 'BEGIN');
SELECT dblink_exec('cleanup', $$SET application_name = 'serialized_offer_cleanup'$$);
SELECT dblink_exec('cleanup', $$SET statement_timeout = '5000ms'$$);
SELECT * FROM dblink('holder', $$SELECT id FROM public.products WHERE id = '00000000-0000-0000-0000-000000000008' FOR UPDATE$$) AS t(id uuid);
SELECT dblink_send_query('cleanup', $$SELECT private.release_stale_offer_line_serialized_units('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', '{}'::jsonb)$$);
DO $$ DECLARE waiting boolean := false; BEGIN
  FOR i IN 1..100 LOOP
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'serialized_offer_cleanup' AND wait_event_type = 'Lock') INTO waiting;
    EXIT WHEN waiting;
    PERFORM pg_sleep(0.05);
  END LOOP;
  ASSERT waiting, 'offer cleanup must wait for the product lock';
END $$;
SELECT * FROM dblink('holder', $$SELECT id FROM public.variant_inventory WHERE id = '00000000-0000-0000-0000-000000000002' FOR UPDATE NOWAIT$$) AS t(id uuid);
SELECT dblink_exec('holder', 'COMMIT');
SELECT * FROM dblink_get_result('cleanup') AS t(result text);
DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id IN ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000013') AND status <> 'available'), 'both reservations must be released'; END $$;
SELECT dblink_disconnect('holder');
SELECT dblink_disconnect('cleanup');
