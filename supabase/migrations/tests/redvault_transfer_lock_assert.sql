-- A competing parent-first checkout holds the item. The inventory trigger
-- must fail immediately rather than waiting while it owns the inventory row.
SELECT dblink_connect('parent', 'dbname=' || current_database() || ' host=' || current_setting('unix_socket_directories') || ' port=' || current_setting('port'));
SELECT dblink_exec('parent','BEGIN');
SELECT dblink_exec('parent',$sql$UPDATE public.order_items SET fulfillment_data='{"concurrent":true}' WHERE id='00000000-0000-0000-0000-000000000002'$sql$);
SET lock_timeout='250ms';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  UPDATE public.variant_inventory SET status='available' WHERE id='00000000-0000-0000-0000-000000000003';
 EXCEPTION WHEN lock_not_available THEN
  IF SQLERRM NOT LIKE 'could not obtain lock%' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected OR (SELECT status FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000003') IS DISTINCT FROM 'reserved' THEN
  RAISE EXCEPTION 'contended transfer must fail and roll back the inventory change';
 END IF;
END $$;
SELECT dblink_exec('parent','ROLLBACK');
SELECT dblink_disconnect('parent');
RESET lock_timeout;
UPDATE public.variant_inventory SET status='available' WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
 IF (SELECT fulfillment_data->>'fulfillmentQuantity' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000002') IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'uncontended inventory update must refresh shipment quantity';
 END IF;
END $$;
