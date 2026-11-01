#!/usr/bin/env python3
"""Exercise the real expiry function on disposable PostgreSQL tables."""
import os
import pathlib
import subprocess
import tempfile
import time

root = pathlib.Path(__file__).resolve().parents[2]
source = (root / 'supabase/migrations/20260615181534_serialized_variant_inventory.sql').read_text()
start = source.index('CREATE OR REPLACE FUNCTION private.release_expired_variant_inventory_reservations(')
end = source.index('\n$$;', start) + len('\n$$;')
function = source[start:end]
if os.environ.get('TEST_LINE_ENDINGS') == 'crlf': function = function.replace('\n', '\r\n')
pg_bin = pathlib.Path(os.environ.get('PG_BIN') or subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
fixture = '''
CREATE SCHEMA auth; CREATE SCHEMA private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.orders(id uuid PRIMARY KEY, merchant_id uuid, payment_status text, shipping_status text, fulfillment_details jsonb);
CREATE TABLE public.order_items(id uuid PRIMARY KEY, order_id uuid, product_id uuid, quantity int, fulfillment_data jsonb);
CREATE TABLE public.products(id uuid PRIMARY KEY, merchant_id uuid);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY, product_id uuid);
CREATE TABLE public.variant_inventory(id uuid PRIMARY KEY, merchant_id uuid, variant_id uuid, order_id uuid, order_item_id uuid, branch_id uuid, status text, identifier_type text, identifier_value text, reserved_at timestamptz, reservation_expires_at timestamptz, updated_at timestamptz);
CREATE FUNCTION private.sync_serialized_stock(uuid,uuid) RETURNS void LANGUAGE sql AS $$ UPDATE public.products SET merchant_id=merchant_id WHERE id=$2 $$;
CREATE FUNCTION private.record_variant_inventory_event(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO orders VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','pending','pending',NULL);
INSERT INTO products VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010');
INSERT INTO product_variants VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020');
INSERT INTO order_items VALUES ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020',1,'{}');
INSERT INTO variant_inventory VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040',NULL,'reserved','imei','test',now(),now()-interval '1 hour',now());
'''
assertions = '''
DO $$ DECLARE result jsonb; BEGIN
 result := private.release_expired_variant_inventory_reservations(NULL,now(),500);
 IF (result->>'totalReleasedCount')::int <> 1 THEN RAISE EXCEPTION 'wrong released count: %', result; END IF;
 IF NOT EXISTS (SELECT 1 FROM variant_inventory WHERE status='available' AND order_id IS NULL AND order_item_id IS NULL) THEN RAISE EXCEPTION 'unit not released'; END IF;
END $$;
'''
with tempfile.TemporaryDirectory(prefix='baci-expiry-test-') as temp:
    path = pathlib.Path(temp); sock = path / 'socket'; sock.mkdir(); data = path / 'data'
    subprocess.run([str(pg_bin/'initdb'),'-D',str(data),'-U','postgres','--auth=trust','--no-locale'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-l',str(path/'server.log'),'-o',f"-h '' -k {sock} -p 55479",'-w','start'], check=True, stdout=subprocess.DEVNULL)
    try:
        psql = [str(pg_bin/'psql'),'-X','-h',str(sock),'-p','55479','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q']
        subprocess.run(psql, input=fixture+'\n'+function, text=True, check=True)
        patch = os.environ.get('BACI_EXPIRY_PATCH', str(root / 'supabase/migrations/20261101220249_serialized_expired_reservation_locking.sql'))
        if patch: subprocess.run(psql+['-f',patch], check=True)
        subprocess.run(psql, input=assertions, text=True, check=True)
        # Recreate a reservation and hold its product in a competing transaction.
        subprocess.run(psql, input="UPDATE variant_inventory SET status='reserved', order_id='00000000-0000-0000-0000-000000000001', order_item_id='00000000-0000-0000-0000-000000000040', reservation_expires_at=now()-interval '1 hour';", text=True, check=True)
        env = dict(os.environ, PGAPPNAME='baci_expiry_lock_regression')
        competing = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        competing.stdin.write("BEGIN; SELECT id FROM products FOR UPDATE; SELECT pg_sleep(1); UPDATE variant_inventory SET updated_at=now(); COMMIT;\n")
        competing.stdin.close()
        try:
            for _ in range(50):
                probe = subprocess.check_output(psql+['-Atc', "SELECT count(*) FROM pg_stat_activity WHERE application_name='baci_expiry_lock_regression' AND wait_event='PgSleep'"], text=True).strip()
                if probe == '1': break
                time.sleep(0.05)
            else: raise RuntimeError('competing transaction did not acquire product lock')
            subprocess.run(psql, input="SET lock_timeout='4s'; "+assertions, text=True, check=True, timeout=8)
            if competing.wait(timeout=8): raise RuntimeError(competing.stderr.read())
        finally:
            if competing.poll() is None: competing.kill(); competing.wait()
        print('Expired reservation release and concurrent product locking passed')
    finally:
        subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'], check=True, stdout=subprocess.DEVNULL)
