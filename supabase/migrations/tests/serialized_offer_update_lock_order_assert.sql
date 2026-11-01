-- Reproduce confirmation holding the product while a merchant edits notes on
-- its reserved unit. The editor must wait before taking the inventory lock.
CREATE TABLE IF NOT EXISTS public.branches (id uuid PRIMARY KEY);
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS name text;
CREATE OR REPLACE FUNCTION private.sync_serialized_stock(p_merchant_id uuid, p_product_id uuid)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE public.products SET updated_at = clock_timestamp()
  WHERE id = p_product_id AND merchant_id = p_merchant_id;
END $$;
UPDATE public.orders SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-00000000f322';
SELECT dblink_connect('confirm_holder', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_connect('unit_editor', format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'), current_setting('port'), current_database()));
SELECT dblink_exec('confirm_holder', 'BEGIN');
SELECT dblink_exec('unit_editor', $$SET application_name = 'serialized_unit_editor'$$);
SELECT dblink_exec('unit_editor', $$SET statement_timeout = '5000ms'$$);
SELECT * FROM dblink('confirm_holder', $$SELECT id FROM public.products WHERE id = '00000000-0000-4000-8000-00000000f314' FOR UPDATE$$) AS t(id uuid);
SELECT dblink_send_query('unit_editor', $$SELECT private.update_variant_inventory_unit(
  '00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f328',
  NULL, NULL, NULL, false, 'updated note')$$);
DO $$
DECLARE waiting boolean := false;
BEGIN
  FOR i IN 1..100 LOOP
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'serialized_unit_editor'
      AND wait_event_type = 'Lock') INTO waiting;
    EXIT WHEN waiting;
    PERFORM pg_sleep(0.05);
  END LOOP;
  ASSERT waiting, 'unit editor must reach the held product lock';
END $$;
-- NOWAIT fails before the fix: the editor has already locked this unit while
-- waiting for the product held by the confirmation transaction.
SELECT * FROM dblink('confirm_holder', $$SELECT id FROM public.variant_inventory WHERE id = '00000000-0000-4000-8000-00000000f328' FOR UPDATE NOWAIT$$) AS t(id uuid);
SELECT dblink_exec('confirm_holder', 'COMMIT');
SELECT * FROM dblink_get_result('unit_editor') AS t(result jsonb);
SELECT dblink_disconnect('confirm_holder');
SELECT dblink_disconnect('unit_editor');
