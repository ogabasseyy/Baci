#!/usr/bin/env python3
"""Run cart review regressions with local PostgreSQL binaries in an owned cluster.

No project credentials or remote network connections are used. --baseline
reproduces the core defects before corrective migrations. All orders are mocks.
"""
import pathlib,tempfile,subprocess,sys,shutil,os
root=pathlib.Path(__file__).resolve().parents[2]
configured_bindir=os.environ.get('PG_BINDIR')
if configured_bindir:
 pg_bindir=pathlib.Path(configured_bindir)
 bindir_source='PG_BINDIR'
else:
 pg_config=os.environ.get('PG_CONFIG') or shutil.which('pg_config')
 if not pg_config:
  raise SystemExit('pg_config not found and PG_BINDIR is unset; install PostgreSQL client/server binaries')
 pg_bindir=pathlib.Path(subprocess.check_output([pg_config,'--bindir'],text=True).strip())
 bindir_source=f'{pg_config} --bindir'
pg_bin={name:pg_bindir/name for name in ['initdb','pg_ctl','psql']}
missing=[str(binary) for binary in pg_bin.values() if not binary.is_file()]
if missing:
 raise SystemExit(f'PostgreSQL binaries missing from {bindir_source} ({pg_bindir}): '+', '.join(missing))
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False
try:
 with open('/tmp/cart-sql-init.log','w') as log:
  subprocess.run([str(pg_bin['initdb']),'-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run([str(pg_bin['pg_ctl']),'-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55489",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
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
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/migrations/20261015144000_commerce_cart_checkout_add_identity.sql').read_text()
 if '--baseline' not in sys.argv:
  for name in ['20261015145000_commerce_cart_checkout_complete_vouchers.sql', '20261015150000_commerce_cart_agentic_checkout_economics.sql','20261015151000_commerce_cart_partial_voucher_binding.sql']: sql+='\n'+(root/'supabase/migrations'/name).read_text()
  sql+='\n'+(root/'supabase/migrations/20261015179997_commerce_cart_binding_loyalty_variant.sql').read_text()
  sql+='\n'+(root/'supabase/migrations/20261029143946_commerce_cart_redvault_binding.sql').read_text()
  # Match the current binder grants from 20261030233000: scoped authenticated
  # routes only; anon and service_role remain unable to call the wrapper.
  sql+="\nREVOKE ALL ON FUNCTION public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb) TO authenticated;"
  if '--without-price-drift-fix' not in sys.argv:
   price_drift_migration=(root/'supabase/migrations/20261106090000_commerce_cart_bind_validated_price.sql').read_text()
   sql+='\n'+price_drift_migration+'\n'+price_drift_migration
   migration_function=price_drift_migration.replace(
    'DO $$',
    'CREATE FUNCTION pg_temp.apply_cart_price_drift_migration() RETURNS void LANGUAGE plpgsql AS $$',
    1,
   )
   migration_function=migration_function.rstrip()
   if not migration_function.endswith('END $$;'):
    raise RuntimeError('Could not extract migration body for mixed-state regression')
   migration_function=migration_function[:-len('END $$;')]+'END; $$;'
   sql+="\nCREATE TEMP TABLE cart_price_drift_binder_backup(definition text); INSERT INTO cart_price_drift_binder_backup VALUES(pg_get_functiondef('public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure));"
   sql+="\nDO $$ DECLARE v_definition text; anchor text := 'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'',line->''validatedUnitPriceMinor'')'; BEGIN SELECT b.definition INTO v_definition FROM cart_price_drift_binder_backup b; v_definition:=overlay(v_definition PLACING 'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'')' FROM position(anchor IN v_definition) FOR length(anchor)); EXECUTE v_definition; END $$;"
   sql+='\n'+migration_function
   sql+="\nDO $$ BEGIN BEGIN PERFORM pg_temp.apply_cart_price_drift_migration(); RAISE EXCEPTION 'partial binding migration unexpectedly succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart binding price comparison anchor count changed' THEN RAISE; END IF; END; END $$;"
   sql+="\nDO $$ DECLARE v_definition text; BEGIN SELECT b.definition INTO v_definition FROM cart_price_drift_binder_backup b; EXECUTE v_definition; END $$;"
 tests=(root/'supabase/tests/commerce_cart_remaining_review.sql').read_text()
 if '--baseline' in sys.argv:
  tests=tests.split('-- Negotiation accepted')[0]+tests[tests.index('DO $$ DECLARE failures text;'):]
 sql+='\n'+tests
 if '--baseline' not in sys.argv:
  sql+='\n'+(root/'supabase/tests/commerce_cart_redvault_binding_fixture.sql').read_text()
  if '--voucher-only' in sys.argv:
   sql+="\nSET test.cart_price_drift_lane='voucher';"
  sql+='\n'+(root/'supabase/tests/commerce_cart_validated_price_binding.sql').read_text()
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/tests/commerce_cart_mutation_lifetime_cap.sql').read_text()
 if '--baseline' not in sys.argv: sql+='\n'+(root/'supabase/tests/commerce_cart_replace_attachment_identity.sql').read_text()
 sql+='\nROLLBACK;'
 r=subprocess.run([str(pg_bin['psql']),'-X','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55489','-U','postgres','-d','postgres'],input=sql,text=True,stdout=open('/tmp/cart-sql-review.log','w'),stderr=subprocess.STDOUT,cwd=root)
 print('PASS' if r.returncode==0 else 'FAIL')
 if r.returncode: print(pathlib.Path('/tmp/cart-sql-review.log').read_text()[-2800:])
 sys.exit(r.returncode)
finally:
 if started: subprocess.run([str(pg_bin['pg_ctl']),'-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
