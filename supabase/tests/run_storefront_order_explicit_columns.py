#!/usr/bin/env python3
"""Exercise the real storefront order wrapper with a sentinel delegate."""
import os
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[2]
source = (root/'supabase/migrations/20261020090000_storefront_order_entrypoint_body_squash.sql').read_text()
start = source.index('CREATE OR REPLACE FUNCTION private.create_storefront_order(')
end = source.index('\n$function$;', start)+len('\n$function$;')
wrapper = source[start:end]
if os.environ.get('TEST_LINE_ENDINGS') == 'crlf': wrapper = wrapper.replace('\n','\r\n')
header = wrapper[:wrapper.index('\n LANGUAGE plpgsql')].replace('private.create_storefront_order(', 'private.create_storefront_order_unchecked(', 1)
stub = header + "\n LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'order'::text, 'tracking'::text, 1::numeric, 2::numeric, 3::numeric, 4::numeric, 5::numeric, '00000000-0000-0000-0000-000000000002'::uuid, 'mail'::text, 'name'::text, 'phone'::text, 'unpaid'::text, 'pending'::text, 'card'::text, '{}'::jsonb, '00000000-0000-0000-0000-000000000003'::uuid, 'exclusive'::text, 6::numeric, true $$;"
pg_bin = pathlib.Path(os.environ.get('PG_BIN') or subprocess.check_output(['pg_config','--bindir'],text=True).strip())
checks = '''
DO $$ DECLARE def text; result jsonb; BEGIN
 SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname='create_storefront_order' AND p.pronargs=24;
 IF def ~* 'SELECT[[:space:]]+\\*' THEN RAISE EXCEPTION 'wildcard delegation remains'; END IF;
 SELECT to_jsonb(r) INTO result FROM private.create_storefront_order('00000000-0000-0000-0000-000000000003'::uuid, 'mail', 'name', '[]'::jsonb) r;
 IF result <> '{"id":"00000000-0000-0000-0000-000000000001","order_number":"order","tracking_token":"tracking","subtotal":1,"shipping_fee":2,"discount_amount":3,"tax_amount":4,"total":5,"customer_id":"00000000-0000-0000-0000-000000000002","customer_email":"mail","customer_name":"name","customer_phone":"phone","payment_status":"unpaid","shipping_status":"pending","payment_method":"card","shipping_address":{},"merchant_id":"00000000-0000-0000-0000-000000000003","tax_basis":"exclusive","gift_wrapping_fee":6,"idempotency_replayed":true}'::jsonb THEN RAISE EXCEPTION 'unexpected returned order %', result; END IF;
 IF current_setting('baci.storefront_order_replay_context',true) <> 'create_storefront_order' THEN RAISE EXCEPTION 'replay marker missing'; END IF;
END $$;
'''
with tempfile.TemporaryDirectory(prefix='baci-order-columns-') as temp:
    path=pathlib.Path(temp); sock=path/'socket'; sock.mkdir(); data=path/'data'
    subprocess.run([str(pg_bin/'initdb'),'-D',str(data),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-l',str(path/'server.log'),'-o',f"-h '' -k {sock} -p 55481",'-w','start'],check=True,stdout=subprocess.DEVNULL)
    try:
        psql=[str(pg_bin/'psql'),'-X','-h',str(sock),'-p','55481','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q']
        subprocess.run(psql,input='CREATE SCHEMA private;\n'+stub+'\n'+wrapper+\
            "\nCREATE ROLE test_caller; REVOKE ALL ON FUNCTION private.create_storefront_order(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION private.create_storefront_order(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text) TO test_caller;",text=True,check=True)
        metadata = "SELECT p.proowner,p.proacl,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='create_storefront_order' AND p.pronargs=24"
        before = subprocess.check_output(psql+['-Atc',metadata],text=True)
        patch=os.environ.get('BACI_ORDER_COLUMNS_PATCH',str(root/'supabase/migrations/20261101220846_storefront_order_explicit_delegation.sql'))
        if patch: subprocess.run(psql+['-f',patch],check=True)
        after = subprocess.check_output(psql+['-Atc',metadata],text=True)
        if before != after: raise RuntimeError('wrapper owner, ACL or security settings changed')
        subprocess.run(psql,input=checks,text=True,check=True)
        # Reapplying the guarded migration must fail rather than patching an unexpected source.
        if patch and subprocess.run(psql+['-f',patch],capture_output=True,text=True).returncode == 0:
            raise RuntimeError('source drift guard did not reject a second application')
        print('Explicit delegation preserves all 20 fields and replay context')
    finally:
        subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)
