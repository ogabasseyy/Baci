#!/usr/bin/env python3
"""Run handoff conflict credential redaction in an owned local PostgreSQL cluster.

No project credentials or remote connections are used. Loads the cart chain
through 20261015130400 plus the 15130600 public RPC redaction.
Use --without-fix to reproduce the original leak; financial leaves have separate fixtures.
"""
import pathlib,tempfile,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False
try:
 with open('/tmp/cart-conflict-redaction-init.log','w') as log:
  subprocess.run(['initdb','-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run(['pg_ctl','-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55492",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
 sql+="\nCREATE TABLE public.mcp_guest_carts(token text PRIMARY KEY,items jsonb,expires_at timestamptz,version bigint,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()); CREATE TABLE public.agentic_cart_sessions(id uuid DEFAULT gen_random_uuid(),cart_id text UNIQUE,merchant_id uuid,agent_id text,cart_items jsonb,currency text DEFAULT 'NGN',status text DEFAULT 'active',expires_at timestamptz DEFAULT now()+interval '7 days',updated_at timestamptz DEFAULT now());"
 sql+='\n\\i '+str(root/'supabase/migrations/20261012050300_commerce_cart_legacy_migration.sql')
 for f in ['20261012050400_commerce_cart_create_grant.sql','20261012050500_commerce_cart_handoff.sql','20261014120000_commerce_cart_account_continuity.sql','20261014120100_commerce_cart_mutation_permissions.sql','20261014120200_commerce_cart_account_tables.sql','20261014120300_commerce_cart_account_functions.sql','20261014120400_commerce_cart_handoff_merge_guards.sql','20261014141000_commerce_cart_checkout_lifetime.sql','20261015090000_commerce_cart_negotiation_policy.sql','20261015100000_commerce_cart_mutation_permissions_restore.sql','20261015110000_commerce_cart_handoff_issue_device_guard.sql','20261015120000_commerce_cart_handoff_merchant_token.sql']:
  sql+='\n\\i '+str(root/'supabase/migrations'/f)
 sql+="\nALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text;\nCREATE TABLE public.variant_inventory(merchant_id uuid,product_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);\nALTER TABLE public.products ADD COLUMN inventory_tracking_policy text DEFAULT 'off',ADD COLUMN inventory_anchor_variant_id uuid;\nALTER TABLE public.product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit',ADD COLUMN is_inventory_anchor boolean DEFAULT false;"
 sql+="\nCREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,metadata jsonb); CREATE TABLE public.product_offers(product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity integer,status text); CREATE SCHEMA discovery; CREATE FUNCTION discovery.canonical_product_condition(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE lower(replace(trim(value),'-','_')) WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box' ELSE lower(replace(trim(value),'-','_')) END $$; CREATE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;"
 if True:
  for f in sorted((root/'supabase/migrations').glob('2026101513*commerce_cart*.sql')):
   if f.name>'20261015130499' and not f.name.startswith('20261015130600'): continue
   if '--without-fix' in sys.argv and f.name.startswith('20261015130600'): continue
   sql+='\n\\i '+str(f)
 tests=(root/'supabase/tests/commerce_cart_handoff_conflict_redaction.sql').read_text()
 sql+='\n'+tests+'\nROLLBACK;'
 r=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55492','-U','postgres','-d','postgres'],input=sql,text=True,stdout=open('/tmp/cart-conflict-redaction-sql.log','w'),stderr=subprocess.STDOUT,cwd=root)
 print('PASS' if r.returncode==0 else 'FAIL')
 if r.returncode: print(pathlib.Path('/tmp/cart-conflict-redaction-sql.log').read_text()[-2800:])
 sys.exit(r.returncode)
finally:
 if started: subprocess.run(['pg_ctl','-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
