#!/usr/bin/env python3
"""Run cart review regressions with local PostgreSQL binaries in an owned cluster.

No project credentials or remote network connections are used. --baseline
reproduces the core defects before corrective migrations. All orders are mocks.
"""
import pathlib,tempfile,subprocess,sys,time,os
root=pathlib.Path(__file__).resolve().parents[2]
pg_bindir=pathlib.Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
pg_tools={name:pg_bindir/name for name in ('initdb','pg_ctl','psql')}
for name,path in pg_tools.items():
 if not path.is_file() or not os.access(path,os.X_OK):
  raise RuntimeError(f'pg_config --bindir does not contain executable {name}: {path}')
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False
try:
 with open('/tmp/cart-sql-init.log','w') as log:
  subprocess.run([str(pg_tools['initdb']),'-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run([str(pg_tools['pg_ctl']),'-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55489",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt()->>'role',nullif(current_setting('request.jwt.claim.role',true),'')) $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
 for f in ['20261012050400_commerce_cart_create_grant.sql','20261012050500_commerce_cart_handoff.sql','20261014120001_commerce_cart_account_continuity.sql','20261014120100_commerce_cart_mutation_permissions.sql','20261014120200_commerce_cart_account_tables.sql','20261014120300_commerce_cart_account_functions.sql','20261014120400_commerce_cart_handoff_merge_guards.sql','20261014141000_commerce_cart_checkout_lifetime.sql','20261015090000_commerce_cart_negotiation_policy.sql','20261015100000_commerce_cart_mutation_permissions_restore.sql','20261015110000_commerce_cart_handoff_issue_device_guard.sql','20261015120000_commerce_cart_handoff_merchant_token.sql']:
  sql+='\n\\i '+str(root/'supabase/migrations'/f)
 sql+="\nALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;\nCREATE TABLE public.variant_inventory(merchant_id uuid,product_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);\nALTER TABLE public.products ADD COLUMN inventory_tracking_policy text DEFAULT 'off',ADD COLUMN inventory_anchor_variant_id uuid;\nALTER TABLE public.product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit',ADD COLUMN is_inventory_anchor boolean DEFAULT false;"
 sql+="\nCREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,metadata jsonb); CREATE SCHEMA private; CREATE TABLE public.product_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity integer,status text); CREATE SCHEMA discovery; CREATE FUNCTION discovery.canonical_product_condition(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE lower(replace(trim(value),'-','_')) WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box' ELSE lower(replace(trim(value),'-','_')) END $$; CREATE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;"
 import re
 inventory=(root/'supabase/migrations/20260615181534_serialized_variant_inventory.sql').read_text()
 sql+='\n'+re.search(r'CREATE OR REPLACE FUNCTION public\.get_effective_inventory_tracking_policy\([\s\S]*?\$\$;',inventory).group()
 if '--baseline' not in sys.argv:
  for f in sorted((root/'supabase/migrations').glob('2026101513*commerce_cart*.sql')):
   if '15130800' in f.name: continue  # concurrent index has a separate autocommit test
   if '--before-condition-writer-fix' in sys.argv and '15130700' in f.name: continue
   # Owner bridge has its own legacy-schema fixture and regression runner.
   if '15130400' in f.name:
    import re
    helper=re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.commerce_cart_resolve_merchant_currency\([\s\S]*?\$\$;',f.read_text())
    if helper: sql+='\n'+helper.group()
    continue
   if '15130500' in f.name:
    import re
    correction=f.read_text()
    if '--before-condition-writer-fix' in sys.argv: correction=correction.replace('commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id, l.condition)','commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id)')
    for match in re.finditer(r'CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$\$;',correction): sql+='\n'+match.group()
   else: sql+='\n\\i '+str(f)
 if '--baseline' not in sys.argv and '--before-lifetime-cap' not in sys.argv:
  sql+='\n'+(root/'supabase/migrations/20261015141000_commerce_cart_mutation_lifetime_cap.sql').read_text()
 if '--baseline' not in sys.argv and '--before-replace-attachment-fix' not in sys.argv:
  sql+=('\n'+(root/'supabase/migrations/20261015142000_commerce_cart_replace_attachment_identity.sql').read_text())*2
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/migrations/20261015143000_commerce_cart_handoff_attachment_lifetime.sql').read_text()
 repair=(root/'supabase/migrations/20261015144000_commerce_cart_checkout_add_identity.sql').read_text()
 if '--before-empty-observation-fix' in sys.argv: repair=repair.split('-- Explicit JSON null records an observed absence.')[0]
 if '--before-checkout-add-fix' not in sys.argv: sql+=('\n'+repair)*2
 if '--baseline' not in sys.argv:
  for name in ['20261015145000_commerce_cart_checkout_complete_vouchers.sql', '20261015150000_commerce_cart_agentic_checkout_economics.sql','20261015151000_commerce_cart_partial_voucher_binding.sql','20261105210000_commerce_cart_checkout_database_clock.sql']: sql+='\n'+(root/'supabase/migrations'/name).read_text()
  sql+='\n'+(root/'supabase/migrations/20261106130000_commerce_cart_delivery_context.sql').read_text()
  delivery_lifetime_migration=(root/'supabase/migrations/20261106140000_commerce_cart_delivery_context_absolute_lifetime.sql').read_text()
  sql+='\n'+delivery_lifetime_migration
  sql+='\n'+delivery_lifetime_migration  # Reapplication must verify all replacements and no-op.
 sql+='\n'+(root/'supabase/tests/commerce_cart_checkout_add_identity.sql').read_text()
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/tests/commerce_cart_delivery_context.sql').read_text()
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/tests/commerce_cart_checkout_database_clock.sql').read_text()
 sql+='\n'+(root/'supabase/tests/commerce_cart_account_empty_observation.sql').read_text()
 sql+='\nCOMMIT;'
 r=subprocess.run([str(pg_tools['psql']),'-X','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55489','-U','postgres','-d','postgres'],input=sql,text=True,stdout=open('/tmp/cart-checkout-add-review.log','w'),stderr=subprocess.STDOUT,cwd=root)
 if r.returncode:
  print('FAIL')
  print(pathlib.Path('/tmp/cart-checkout-add-review.log').read_text()[-2800:])
  sys.exit(r.returncode)
 if '--baseline' not in sys.argv:
  psql=[str(pg_tools['psql']),'-X','-q','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55489','-U','postgres','-d','postgres']
  barrier_key=366221123
  def wait_for_activity(query):
   deadline=time.monotonic()+8
   delay=0.01
   while time.monotonic()<deadline:
    remaining=deadline-time.monotonic()
    try:
     probe=subprocess.run(psql+['-At','-c',query],text=True,capture_output=True,cwd=root,
       timeout=max(0.1,min(1.0,remaining)))
    except subprocess.TimeoutExpired:
     probe=None
    if probe is not None and probe.returncode==0 and probe.stdout.strip()=='1': return True
    time.sleep(min(delay,max(0,deadline-time.monotonic())))
    delay=min(delay*2,0.1)
   return False

  controller_env=os.environ.copy(); controller_env['PGAPPNAME']='delivery-context-controller'
  controller=subprocess.Popen(psql+['-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=controller_env,cwd=root)
  controller.stdin.write(f'SELECT pg_advisory_lock({barrier_key});\n')
  controller.stdin.flush()
  controller_lock_probe=("SELECT count(*) FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid "
    "WHERE a.application_name='delivery-context-controller' AND a.state='idle' "
    f"AND l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
    f"AND l.classid=0::oid AND l.objid={barrier_key}::oid AND l.objsubid=1 AND l.granted;")
  if not wait_for_activity(controller_lock_probe):
   controller.kill(); controller.communicate()
   raise RuntimeError('delivery-context controller did not acquire its barrier lock')
  holder_sql=("BEGIN; SET LOCAL statement_timeout='25s'; SET LOCAL deadlock_timeout='200ms'; "
    "SELECT id FROM public.commerce_carts WHERE id='aaaaaaaa-6600-4000-8000-000000000002' FOR UPDATE; "
    f"SELECT pg_advisory_lock({barrier_key}); "
    "UPDATE public.commerce_cart_checkout_sessions SET reviewed_snapshot=reviewed_snapshot "
    "WHERE id='cccccccc-6600-4000-8000-000000000002'; COMMIT;")
  holder_env=os.environ.copy(); holder_env['PGAPPNAME']='delivery-context-cart-lock-holder'
  holder=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=holder_env,cwd=root)
  holder.stdin.write(holder_sql)
  holder.stdin.flush()
  holder.stdin.close()
  holder.stdin=None
  if not wait_for_activity("SELECT count(*) FROM pg_stat_activity WHERE application_name='delivery-context-cart-lock-holder' AND state='active' AND wait_event='advisory';"):
   controller.stdin.write(f'SELECT pg_advisory_unlock({barrier_key});\\q\n'); controller.stdin.flush(); controller.stdin.close(); controller.stdin=None
   controller.communicate(); holder.kill(); holder.communicate()
   print('FAIL: did not observe cart-lock holder before delivery-context call')
   sys.exit(1)
  claim=("{\"role\":\"commerce_cart_shopper\",\"exp\":9999999999,"
    "\"cart_scope\":\"session\",\"cart_merchant_id\":\"11111111-1111-4111-8111-111111111111\","
    "\"cart_id\":\"aaaaaaaa-6600-4000-8000-000000000002\","
    "\"cart_grant_id\":\"bbbbbbbb-6600-4000-8000-000000000003\","
    "\"cart_principal_id\":\"delivery-context-lock\"}")
  delivery_sql=("BEGIN; SET LOCAL statement_timeout='25s'; SET LOCAL deadlock_timeout='200ms'; "
    f"SELECT set_config('request.jwt.claims','{claim}',true); "
    "SELECT public.commerce_cart_delivery_context("
    "'cccccccc-6600-4000-8000-000000000002',9,3)->>'ok'; COMMIT;")
  caller_env=os.environ.copy(); caller_env['PGAPPNAME']='delivery-context-caller'
  caller=subprocess.Popen(psql+['-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=caller_env,cwd=root)
  caller.stdin.write(delivery_sql)
  caller.stdin.flush()
  caller.stdin.close()
  caller.stdin=None
  if not wait_for_activity("SELECT count(*) FROM pg_stat_activity WHERE application_name='delivery-context-caller' AND state='active' AND wait_event_type='Lock' AND query LIKE '%commerce_cart_delivery_context%';"):
   controller.stdin.write(f'SELECT pg_advisory_unlock({barrier_key});\\q\n'); controller.stdin.flush(); controller.stdin.close(); controller.stdin=None
   controller.communicate(); caller.kill(); caller.communicate(); holder.communicate()
   print('FAIL: delivery-context caller never reached the cart-lock wait')
   sys.exit(1)
  controller.stdin.write(f'SELECT pg_advisory_unlock({barrier_key});\\q\n')
  controller.stdin.flush()
  controller.stdin.close()
  controller.stdin=None
  controller.communicate(timeout=8)
  delivery_out,delivery_err=caller.communicate(timeout=8)
  holder_out,holder_err=holder.communicate(timeout=8)
  if caller.returncode or holder.returncode or delivery_out.splitlines()[-1:]!=['true']:
   print('FAIL: delivery-context cart/session lock-order race')
   print((delivery_err+holder_err+delivery_out+holder_out)[-2400:])
   sys.exit(1)
 print('PASS')
finally:
 if started: subprocess.run([str(pg_tools['pg_ctl']),'-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
