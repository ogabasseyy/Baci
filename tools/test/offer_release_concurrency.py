from pathlib import Path
import os,subprocess,tempfile,json
repo=Path(__file__).resolve().parents[2]
root=Path(tempfile.mkdtemp(prefix='baci-redvault-3813-')); (root/'socket').mkdir(mode=0o700)
bin=Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
def run(name,args,input=None):
 return subprocess.run([str(bin/name),*args],input=input,text=True,capture_output=True,env=env,timeout=30)
def ok(r):
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
def sql(s):return run('psql',['-X','-w','-v','ON_ERROR_STOP=1','-h',str(root/'socket'),'-p','55479','-U','postgres','-d','postgres'],s)
started=False
setup='''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE TABLE private.uba_redvault_write_context(transaction_id bigint PRIMARY KEY);
CREATE TABLE public.merchants(id uuid PRIMARY KEY,email text,business_name text,slug text,is_published boolean);
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid,name text,price numeric,status text,condition text,stock_quantity int,manage_stock boolean,has_condition_offers boolean,has_variants boolean,inventory_tracking_policy text,inventory_anchor_variant_id uuid);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,attributes jsonb,price_override numeric,inventory_tracking_policy text,is_inventory_anchor boolean);
CREATE TABLE public.product_offers(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity int,status text);
CREATE TABLE public.orders(id uuid PRIMARY KEY,payment_method text);
CREATE TABLE public.order_items(id uuid PRIMARY KEY,order_id uuid,product_id uuid,offer_line boolean,product_offer_id uuid,offer_labels_snapshotted boolean,offer_id uuid,offer_id_snapshot uuid,fulfillment_data jsonb);
CREATE TABLE public.variant_inventory(id uuid PRIMARY KEY,variant_id uuid,merchant_id uuid,identifier_type text,identifier_value text,status text,order_id uuid,order_item_id uuid,reserved_at timestamptz,first_reserved_at timestamptz,reservation_expires_at timestamptz,branch_id uuid,updated_at timestamptz);
CREATE FUNCTION private.fixture_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
CREATE TRIGGER order_items_offer_id_snapshot_guard BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.fixture_identity_guard();
CREATE TABLE private.fixture_events(unit_id uuid);
CREATE FUNCTION private.record_variant_inventory_event(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$INSERT INTO private.fixture_events VALUES ($1)$$;
CREATE FUNCTION public.create_storefront_order(p_merchant_id uuid,p_customer_email text,p_customer_name text,p_items jsonb)
RETURNS TABLE(id uuid,tracking_token text) LANGUAGE plpgsql AS $$
DECLARE v_order uuid:=gen_random_uuid(); v_item uuid:=gen_random_uuid(); v_offer uuid:=(p_items->0->>'offer_id')::uuid;
BEGIN
 INSERT INTO public.orders VALUES(v_order,NULL);
 INSERT INTO public.order_items(id,order_id,product_id,offer_line,product_offer_id,offer_labels_snapshotted,offer_id,offer_id_snapshot)
 VALUES(v_item,v_order,(p_items->0->>'product_id')::uuid,v_offer IS NOT NULL,v_offer,v_offer IS NOT NULL,v_offer,v_offer);
 IF v_offer IS NULL THEN
  UPDATE public.variant_inventory vi SET status='reserved',order_id=v_order,order_item_id=v_item
  WHERE vi.id=(SELECT vi2.id FROM public.variant_inventory vi2 WHERE vi2.status='available' ORDER BY vi2.id LIMIT 1);
 END IF;
 RETURN QUERY SELECT v_order,'fixture-token'::text;
END$$;
'''
trigger=(repo/'supabase/migrations/20261028090000_redvault_offer_shipment_quantity.sql').read_text()
helper=(repo/'supabase/migrations/20261027164947_preserve_attached_offer_unit_snapshots.sql').read_text()
fixture=(repo/'supabase/migrations/tests/redvault_offer_shipment_quantity.sql').read_text()
attachment='''CREATE TRIGGER persist_redvault_quantity AFTER UPDATE ON public.variant_inventory FOR EACH ROW EXECUTE FUNCTION private.persist_redvault_surviving_shipment_quantity_from_inventory();'''
results=[]
try:
 ok(run('initdb',['-D',str(root/'data'),'-A','trust','-U','postgres','--no-locale','--encoding=UTF8']))
 ok(run('pg_ctl',['-D',str(root/'data'),'-o',f"-k '{root/'socket'}' -h '' -p 55479",'-l',str(root/'postgres.log'),'start']));started=True
 ok(sql(setup+trigger+helper+attachment))
 import sys,time
 if '--baseline' not in sys.argv:
  matches=sorted((repo/'supabase/migrations').glob('*lock_offer_release_item.sql'));assert len(matches)==1;ok(sql(matches[0].read_text()))
 ok(sql("""INSERT INTO public.orders(id,payment_method) VALUES ('00000000-0000-4000-8000-000000000001','uba_redvault');
 INSERT INTO public.order_items(id,order_id,offer_line,fulfillment_data) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',true,'{"inventoryUnits":[{"id":"stale"}],"source":"merchant_stock"}');"""))
 args=[str(bin/'psql'),'-X','-w','-v','ON_ERROR_STOP=1','-h',str(root/'socket'),'-p','55479','-U','postgres','-d','postgres']
 locker=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,env=env)
 locker.stdin.write("BEGIN; UPDATE public.order_items SET fulfillment_data=fulfillment_data || '{\"refund\":true}'::jsonb WHERE id='00000000-0000-4000-8000-000000000002'; SELECT pg_sleep(3); COMMIT;\n");locker.stdin.close()
 # Wait until the writer is sleeping while holding its item row lock.
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  observed=ok(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND query LIKE '%pg_sleep(3)%';"))
  if any(line.strip() == '1' for line in observed.splitlines()): break
  time.sleep(0.05)
 else: raise RuntimeError('writer did not acquire the item lock')
 r=sql("SELECT private.release_stale_offer_line_serialized_units('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','{}');");ok(r);assert locker.wait(timeout=10)==0
 result=ok(sql("SELECT fulfillment_data FROM public.order_items WHERE id='00000000-0000-4000-8000-000000000002';"))
 if '--baseline' not in sys.argv:
  assert 'refund' in result, result;print('fixed: concurrent refund metadata survives')
 else:
  assert 'refund' not in result,result;print('baseline: reproduced overwritten concurrent refund metadata')

 # Mismatched tenant references must remain attached and produce no release
 # event, even when a matching reservation is released in the same call.
 ok(sql("""
 INSERT INTO public.variant_inventory(id,merchant_id,order_id,order_item_id,status) VALUES
 ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','reserved'),
 ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','reserved');
 SELECT private.release_stale_offer_line_serialized_units('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','{}');
 DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-4000-8000-000000000006' AND status='reserved' AND order_item_id='00000000-0000-4000-8000-000000000002')
 OR EXISTS(SELECT 1 FROM private.fixture_events WHERE unit_id='00000000-0000-4000-8000-000000000006') THEN
 RAISE EXCEPTION 'foreign reservation was released'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.fixture_events WHERE unit_id='00000000-0000-4000-8000-000000000005') THEN
 RAISE EXCEPTION 'matching reservation was not released'; END IF;
 END $$;
 """));print('tenant-mismatched reservation preserved without a release event')

finally:
 if started:ok(run('pg_ctl',['-D',str(root/'data'),'-m','fast','stop']))
 import shutil;shutil.rmtree(root)
