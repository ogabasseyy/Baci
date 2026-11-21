#!/usr/bin/env python3
"""Run cart review regressions with local PostgreSQL binaries in an owned cluster.

No project credentials or remote network connections are used. --baseline
reproduces the core defects before corrective migrations. All orders are mocks.
"""
import pathlib,tempfile,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False
try:
 with open('/tmp/cart-sql-init.log','w') as log:
  subprocess.run(['initdb','-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run(['pg_ctl','-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55489",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
 for f in ['20261012050400_commerce_cart_create_grant.sql','20261012050500_commerce_cart_handoff.sql','20261014120001_commerce_cart_account_continuity.sql','20261014120100_commerce_cart_mutation_permissions.sql','20261014120200_commerce_cart_account_tables.sql','20261014120300_commerce_cart_account_functions.sql','20261014120400_commerce_cart_handoff_merge_guards.sql','20261014141000_commerce_cart_checkout_lifetime.sql','20261015090000_commerce_cart_negotiation_policy.sql','20261015100000_commerce_cart_mutation_permissions_restore.sql','20261015110000_commerce_cart_handoff_issue_device_guard.sql','20261015120000_commerce_cart_handoff_merchant_token.sql']:
  sql+='\n\\i '+str(root/'supabase/migrations'/f)
 sql+="\nALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;\nCREATE TABLE public.variant_inventory(merchant_id uuid,product_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);\nALTER TABLE public.products ADD COLUMN inventory_tracking_policy text DEFAULT 'off',ADD COLUMN inventory_anchor_variant_id uuid;\nALTER TABLE public.product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit',ADD COLUMN is_inventory_anchor boolean DEFAULT false;"
 sql+="\nCREATE TABLE public.checkout_sessions(id uuid,session_id text,merchant_id uuid,metadata jsonb); CREATE SCHEMA private; CREATE TABLE public.product_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity integer,status text); CREATE SCHEMA discovery; CREATE FUNCTION public.get_public_serialized_variant_availability_counts(p_merchant_id uuid,p_product_ids uuid[],p_branch_id uuid) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT vi.product_id,vi.variant_id,count(*)::integer FROM public.variant_inventory vi WHERE vi.merchant_id=p_merchant_id AND vi.product_id=ANY(p_product_ids) AND vi.status='available' AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL GROUP BY vi.product_id,vi.variant_id $$;"
 sql+='\n'+(root/'supabase/migrations/20261001170000_canonical_product_condition.sql').read_text()
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
 repair=(root/'supabase/migrations/20261015143000_commerce_cart_handoff_attachment_lifetime.sql').read_text()
 if '--before-anchor-guards' in sys.argv:
  for message in ['handoff canonical quantity source mismatch','handoff new connect grant source mismatch','handoff issue declaration source mismatch','handoff issue deadline source mismatch','handoff issue receipt source mismatch']:
   repair='\n'.join(line for line in repair.splitlines() if "RAISE EXCEPTION '"+message+"'" not in line)
 if '--before-handoff-fix' not in sys.argv:
  sql+='\n'+(root/'supabase/tests/commerce_cart_handoff_source_drift.sql').read_text()
  sql+='\nSELECT pg_temp.check_handoff_source_drift($migration$'+repair+'$migration$);'
  sql+=('\n'+repair)*2
 if '--baseline' not in sys.argv:
  for name in ['20261015144000_commerce_cart_checkout_add_identity.sql','20261015145000_commerce_cart_checkout_complete_vouchers.sql','20261015150000_commerce_cart_agentic_checkout_economics.sql','20261015151000_commerce_cart_partial_voucher_binding.sql']: sql+='\n'+(root/'supabase/migrations'/name).read_text()
 sql+='\n'+(root/'supabase/migrations/20261015167000_commerce_cart_merge_chosen_quantity.sql').read_text()
 sql+='\n'+(root/'supabase/migrations/20261015168000_commerce_cart_handoff_preview_raw_token.sql').read_text()
 sql+='\n'+(root/'supabase/migrations/20261015169000_commerce_cart_canonical_feature_guard.sql').read_text()
 for name in ['20261015172000_commerce_cart_handoff_preview_token_param.sql','20261015179990_commerce_cart_scoped_preview.sql']:
  sql+='\n'+(root/'supabase/migrations'/name).read_text()
 sql+='\n'+(root/'supabase/tests/commerce_cart_handoff_attachment_lifetime.sql').read_text()
 if '--mcp-import' in sys.argv:
  sql+='\n'+(root/'supabase/tests/commerce_cart_mcp_import_source_drift.sql').read_text()
  inherited_condition = """coalesce(
      discovery.canonical_product_condition(variant.condition),
      discovery.canonical_product_condition(coalesce(product.condition, 'new'))
    )"""
  drift_probes = {
   '20261121103800': ('inherited variant source mismatch', [
    'discovery.canonical_product_condition(variant.condition)',
    "item.identity->'options' = '{}'::jsonb",
    "variant.attributes = '{}'::jsonb",
    "destination_line.options = copy.value->'item'->'options'",
   ]),
   '20261121103900': ('legacy destination source mismatch', [
    "    AND coalesce(item.identity->'options', '{}'::jsonb) = '{}'::jsonb",
   ]),
   '20261121104000': ('condition destination source mismatch', [
    "'variantId', variant.id, 'condition', " + inherited_condition,
    'AND ' + inherited_condition + ' =',
   ]),
   '20261121104100': ('condition alias anchor mismatch', [
    "'variantId', CASE WHEN EXISTS (",
    ')) END ORDER BY entry.ordinality)',
    "AND offer.status = 'active'\n    );",
    "AND legacy_line.condition IS NULL AND coalesce(nullif(legacy_line.options, 'null'::jsonb), '{}'::jsonb) = '{}'::jsonb",
   ]),
  }
  sql+="\nALTER TABLE public.products ADD COLUMN default_variant_id uuid, ADD COLUMN condition text DEFAULT 'new';"
  sql+="\nALTER TABLE public.product_variants ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}', ADD COLUMN condition text;"
  for name in ['20261015160000_commerce_cart_redeem_grant_expiry.sql',
               '20261015175000_commerce_cart_variant_predicate_columns.sql',
               '20261019172000_commerce_cart_offer_variant_columns.sql',
               '20261019183000_commerce_cart_default_variant_predicate.sql',
               '20261120182000_commerce_cart_import_mcp_handoff.sql',
               '20261121103000_commerce_cart_mcp_handoff_refresh_replay.sql',
               '20261121103100_commerce_cart_mcp_handoff_import_mode.sql',
               '20261121103200_commerce_cart_mcp_handoff_incremental_import.sql',
               '20261121103300_commerce_cart_mcp_import_destination_identity.sql',
               '20261121103400_commerce_cart_mcp_import_refresh_grant.sql',
               '20261121103500_commerce_cart_mcp_import_quantity_high_water.sql',
               '20261121103600_commerce_cart_mcp_import_merge_continuity.sql',
               '20261121103700_commerce_cart_mcp_import_default_variant.sql',
               '20261121103800_commerce_cart_mcp_import_inherited_variant.sql',
               '20261121103900_commerce_cart_mcp_import_legacy_destination.sql',
               '20261121104000_commerce_cart_mcp_import_condition_destination.sql',
               '20261121104100_commerce_cart_mcp_import_condition_alias.sql']:
   migration=(root/'supabase/migrations'/name).read_text()
   if probe := drift_probes.get(name.split('_', 1)[0]):
    reason, anchors = probe
    anchor_array = ', '.join(f'$anchor${anchor}$anchor$' for anchor in anchors)
    sql+=f"\nSELECT pg_temp.check_mcp_import_source_drift($repair${migration}$repair$, ARRAY[{anchor_array}], 'MCP cart import {reason}');"
   sql+='\n'+migration
  sql+="\nALTER TABLE public.product_variants DROP COLUMN is_active, DROP COLUMN status, DROP COLUMN deleted_at, DROP COLUMN archived_at, DROP COLUMN is_default;"
  sql+='\n'+(root/'supabase/tests/commerce_cart_import_mcp_sku_cases.sql').read_text()
  sql+='\n'+(root/'supabase/tests/commerce_cart_import_mcp_handoff.sql').read_text()
 sql+='\nROLLBACK;'
 r=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55489','-U','postgres','-d','postgres'],input=sql,text=True,stdout=open('/tmp/cart-handoff-attachment-lifetime.log','w'),stderr=subprocess.STDOUT,cwd=root)
 print('PASS' if r.returncode==0 else 'FAIL')
 if r.returncode: print(pathlib.Path('/tmp/cart-handoff-attachment-lifetime.log').read_text()[-2800:])
 sys.exit(r.returncode)
finally:
 if started: subprocess.run(['pg_ctl','-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
