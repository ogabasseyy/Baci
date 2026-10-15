#!/usr/bin/env python3
"""Run competing handoff public RPCs with owned disposable PostgreSQL sessions.

No project credentials, remote services, real orders or payments are used.
--without-fix restores the row-before-advisory wrapper to reproduce the deadlock.
"""
import pathlib,tempfile,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False; children=[]
try:
 with open('/tmp/cart-handoff-lock-init.log','w') as log:
  subprocess.run(['initdb','-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run(['pg_ctl','-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55493",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
 sql+="\nCREATE TABLE public.mcp_guest_carts(token text PRIMARY KEY,items jsonb,expires_at timestamptz,version bigint,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()); CREATE TABLE public.agentic_cart_sessions(id uuid DEFAULT gen_random_uuid(),cart_id text UNIQUE,merchant_id uuid,agent_id text,cart_items jsonb,currency text DEFAULT 'NGN',status text DEFAULT 'active',expires_at timestamptz DEFAULT now()+interval '7 days',updated_at timestamptz DEFAULT now());"
 sql+='\n\\i '+str(root/'supabase/migrations/20261012050300_commerce_cart_legacy_migration.sql')
 for f in ['20261012050400_commerce_cart_create_grant.sql','20261012050500_commerce_cart_handoff.sql','20261014120000_commerce_cart_account_continuity.sql','20261014120100_commerce_cart_mutation_permissions.sql','20261014120200_commerce_cart_account_tables.sql','20261014120300_commerce_cart_account_functions.sql','20261014120400_commerce_cart_handoff_merge_guards.sql','20261014141000_commerce_cart_checkout_lifetime.sql','20261015090000_commerce_cart_negotiation_policy.sql','20261015100000_commerce_cart_mutation_permissions_restore.sql','20261015110000_commerce_cart_handoff_issue_device_guard.sql','20261015120000_commerce_cart_handoff_merchant_token.sql']:
  sql+='\n\\i '+str(root/'supabase/migrations'/f)
 sql+="\nALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;\nCREATE TABLE public.variant_inventory(merchant_id uuid,product_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);\nALTER TABLE public.products ADD COLUMN inventory_tracking_policy text DEFAULT 'off',ADD COLUMN inventory_anchor_variant_id uuid;\nALTER TABLE public.product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit',ADD COLUMN is_inventory_anchor boolean DEFAULT false;"
 sql+="\nCREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,metadata jsonb); CREATE TABLE public.product_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity integer,status text); CREATE SCHEMA discovery; CREATE FUNCTION discovery.canonical_product_condition(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE lower(replace(trim(value),'-','_')) WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box' ELSE lower(replace(trim(value),'-','_')) END $$; CREATE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;"
 import re
 inventory=(root/'supabase/migrations/20260615181534_serialized_variant_inventory.sql').read_text()
 sql+='\n'+re.search(r'CREATE OR REPLACE FUNCTION public\.get_effective_inventory_tracking_policy\([\s\S]*?\$\$;',inventory).group()
 if '--baseline' not in sys.argv:
  for f in sorted((root/'supabase/migrations').glob('2026101513*commerce_cart*.sql')):
   if '15130800' in f.name: continue  # actual financial runner validates concurrently outside a transaction
   if '15130500' in f.name:
    # Financial/reversal schema has a separate actual-order fixture; compose
    # EVERY final cart function, including the private owner implementation.
    for match in re.finditer(r'CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$\$;',f.read_text()): sql+='\n'+match.group()
   else: sql+='\n\\i '+str(f)
 import json,time
 for name in ['20261015141000_commerce_cart_mutation_lifetime_cap.sql','20261015142000_commerce_cart_replace_attachment_identity.sql']:
  sql+='\n'+(root/'supabase/migrations'/name).read_text()
 sql+='\n'+(root/'supabase/tests/commerce_cart_handoff_lock_order.sql').read_text()
 if '--without-fix' in sys.argv:
  wrapper=(root/'supabase/migrations/20261015130600_commerce_cart_handoff_conflict_redaction.sql').read_text().split('CREATE OR REPLACE FUNCTION public.commerce_cart_redeem_handoff(',1)[1]
  wrapper='CREATE OR REPLACE FUNCTION public.commerce_cart_redeem_handoff('+wrapper
  wrapper=wrapper.replace(" PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-handoff|' || p_token_hash, 0));\n",'')
  sql+='\n'+wrapper
 sql+='\nCOMMIT;'
 connection=['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55493','-U','postgres','-d','postgres']
 setup=subprocess.run(connection,input=sql,text=True,stdout=open('/tmp/cart-handoff-lock-setup.log','w'),stderr=subprocess.STDOUT,cwd=root)
 if setup.returncode: raise RuntimeError(pathlib.Path('/tmp/cart-handoff-lock-setup.log').read_text()[-2400:])
 a=subprocess.Popen(connection,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True); children.append(a)
 a.stdin.write("BEGIN; SET deadlock_timeout='100ms'; SET lock_timeout='5s'; SELECT pg_advisory_xact_lock(hashtextextended('cc-handoff|lock-order-handoff',0)); SELECT 'LOCK_READY';\n"); a.stdin.flush()
 while a.stdout.readline().strip()!='LOCK_READY':
  if a.poll() is not None: raise RuntimeError('Advisory lock owner exited')
 merchant='11111111-1111-4111-8111-111111111111'
 base={'role':'commerce_cart_shopper','exp':9999999999,'cart_merchant_id':merchant}
 merge={**base,'cart_scope':'session','cart_principal_id':'lock-merge-receiver','cart_id':'aaaaaaaa-2000-4000-8000-000000000002','cart_grant_id':'bbbbbbbb-2000-4000-8000-000000000002'}
 connect={**base,'cart_scope':'bootstrap','cart_principal_id':'lock-connect-receiver'}
 b=subprocess.Popen(connection,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True); children.append(b)
 merge_rpc="SELECT public.commerce_cart_redeem_handoff('lock-order-handoff','cccccccc-2000-4000-8000-000000000001','merge-race','merge','native','aaaaaaaa-2000-4000-8000-000000000002',1,1,'[{\"item\":{\"productId\":\"44444444-4444-4444-8444-444444444444\"},\"quantity\":1}]','[]');"
 b.stdin.write("BEGIN; SET application_name='cart-lock-merge-B'; SET deadlock_timeout='100ms'; SET lock_timeout='5s'; SET request.jwt.claims='"+json.dumps(merge)+"'; "+merge_rpc+" COMMIT;\n"); b.stdin.close(); b.stdin=None
 deadline=time.monotonic()+5
 while True:
  blocked=subprocess.run(connection+['-c',"SELECT count(*) FROM pg_stat_activity WHERE application_name='cart-lock-merge-B' AND wait_event='advisory'"],text=True,capture_output=True,check=True).stdout.strip()
  if blocked=='1': break
  if b.poll() is not None: raise RuntimeError('Merge RPC exited before synchronization: '+b.communicate()[1])
  if time.monotonic()>deadline: raise RuntimeError('Merge RPC did not reach its advisory wait')
  time.sleep(0.02)
 connect_rpc="SELECT public.commerce_cart_redeem_handoff('lock-order-handoff','cccccccc-2000-4000-8000-000000000001','connect-race','connect','native',NULL,1,NULL,NULL,'[]');"
 a_output,a_error=a.communicate("SET request.jwt.claims='"+json.dumps(connect)+"'; "+connect_rpc+" COMMIT;\n",timeout=8)
 b_output,b_error=b.communicate(timeout=8)
 pathlib.Path('/tmp/cart-handoff-lock-sessions.log').write_text('CONNECT\n'+a_output+a_error+'\nMERGE\n'+b_output+b_error)
 if a.returncode or b.returncode: raise RuntimeError('Concurrent public RPC failed: '+a_error+b_error)
 outcomes=[json.loads(line) for line in (a_output+'\n'+b_output).splitlines() if line.startswith('{')]
 if not any(x.get('ok') is True and x.get('choice')=='connect' for x in outcomes): raise RuntimeError('Connect did not succeed')
 if not any(x.get('code')=='handoff_consumed' for x in outcomes): raise RuntimeError('Competing merge did not reconcile consumed handoff')
 print('PASS: competing public connect/merge RPCs reconcile without a lock cycle')
finally:
 for child in children:
  if child.poll() is None: child.terminate(); child.communicate(timeout=5)
 if started: subprocess.run(['pg_ctl','-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
