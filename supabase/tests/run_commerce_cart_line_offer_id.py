#!/usr/bin/env python3
"""Run the exact-offer cart identity SQL regression in an owned local cluster.

Assembles the order-binding fixture preamble plus the cart migration chain
through the offer-id migrations, then executes
commerce_cart_line_offer_id.sql. No credentials or remote connections.
"""
import pathlib,tempfile,subprocess,sys,shutil
root=pathlib.Path(__file__).resolve().parents[2]
p=pathlib.Path(tempfile.mkdtemp(prefix='cart-review-pg-')); (p/'sock').mkdir(); started=False
try:
 with open(p/'init.log','w') as log:
  subprocess.run(['initdb','-D',str(p/'data'),'-U','postgres','--auth=trust','--no-locale'],check=True,stdout=log,stderr=log)
  subprocess.run(['pg_ctl','-D',str(p/'data'),'-l',str(p/'pg.log'),'-o',f"-h '' -k {p/'sock'} -p 55489",'start'],check=True,stdout=log,stderr=log);started=True
 sql=(root/'supabase/tests/commerce_cart_order_binding.sql').read_text().split('-- 7. Bound submission')[0]
 sql='\n'.join('\\i '+str((root/'supabase/tests'/s[4:]).resolve()) if s.startswith('\\ir ') else s for s in sql.splitlines())
 sql+="\nCREATE ROLE authenticator; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$; CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);"
 for f in ['20261012050400_commerce_cart_create_grant.sql','20261012050500_commerce_cart_handoff.sql','20261014120001_commerce_cart_account_continuity.sql','20261014120100_commerce_cart_mutation_permissions.sql','20261014120200_commerce_cart_account_tables.sql','20261014120300_commerce_cart_account_functions.sql','20261014120400_commerce_cart_handoff_merge_guards.sql','20261014141000_commerce_cart_checkout_lifetime.sql','20261015090000_commerce_cart_negotiation_policy.sql','20261015100000_commerce_cart_mutation_permissions_restore.sql','20261015110000_commerce_cart_handoff_issue_device_guard.sql','20261015120000_commerce_cart_handoff_merchant_token.sql']:
  sql+='\n\\i '+str(root/'supabase/migrations'/f)
 sql+="\nALTER TABLE public.merchants ADD COLUMN payout_currency text DEFAULT 'NGN', ADD COLUMN country text,ADD COLUMN is_published boolean DEFAULT true,ADD COLUMN is_platform_admin boolean DEFAULT false;\nCREATE TABLE public.variant_inventory(merchant_id uuid,product_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);\nALTER TABLE public.products ADD COLUMN inventory_tracking_policy text DEFAULT 'off',ADD COLUMN inventory_anchor_variant_id uuid;\nALTER TABLE public.product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit',ADD COLUMN is_inventory_anchor boolean DEFAULT false;"
 sql+="\nCREATE FUNCTION public.current_agentic_merchant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT CASE WHEN (auth.jwt()->>'agentic_merchant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (auth.jwt()->>'agentic_merchant_id')::uuid ELSE NULL END $$; CREATE FUNCTION public.is_agentic_checkout_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE((auth.jwt()->>'agentic_context')='checkout', FALSE) $$;"
 sql+="\nCREATE SCHEMA realtime; CREATE TABLE realtime.messages(topic text, extension text, private boolean); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;"
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
  for name in ['20261015145000_commerce_cart_checkout_complete_vouchers.sql', '20261015150000_commerce_cart_agentic_checkout_economics.sql','20261015151000_commerce_cart_partial_voucher_binding.sql','20261015152000_commerce_cart_voucher_pair_writers.sql','20261015154000_commerce_cart_terminal_purge_schedule.sql','20261015155000_commerce_cart_handoff_partial_pairs.sql','20261015156000_commerce_cart_grant_operations.sql','20261015157000_commerce_cart_worker_outbox_scope.sql','20261015153000_commerce_cart_terminal_purge.sql']: sql+='\n'+(root/'supabase/migrations'/name).read_text()
 sql+='\n\\i '+str(root/'supabase/migrations/20261015158000_commerce_cart_grant_expiry.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015159000_commerce_cart_purge_search_path.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015160000_commerce_cart_redeem_grant_expiry.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015161000_commerce_cart_retirement_retention.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015162000_commerce_cart_terminal_purge_unschedule.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015163000_commerce_cart_cleanup_bounded.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015164000_commerce_cart_cleanup_indexes.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261014070000_commerce_cart_broadcast.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015165000_commerce_cart_receive_receiver_only.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015166000_commerce_cart_receiver_predicate_split.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015167000_commerce_cart_merge_chosen_quantity.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015168000_commerce_cart_handoff_preview_raw_token.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015169000_commerce_cart_canonical_feature_guard.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015171000_commerce_cart_legacy_bridge_lane_metadata.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015172000_commerce_cart_handoff_preview_token_param.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015173000_commerce_cart_recovery_marker_clear.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015174000_commerce_cart_agentic_variant_read.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015175000_commerce_cart_variant_predicate_columns.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015177000_commerce_cart_feature_guard_nonarray.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179000_commerce_cart_shared_clear_guard.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179910_commerce_cart_zero_negotiation.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179920_commerce_cart_handoff_union_award_lanes.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179940_commerce_cart_bootstrap_insert_shape.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179950_commerce_cart_purge_search_path.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179960_commerce_cart_creation_receipt_insert_revoke.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179970_commerce_cart_checkout_snapshot_zero_negotiation.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179990_commerce_cart_scoped_preview.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261015179997_commerce_cart_binding_loyalty_variant.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261019172000_commerce_cart_offer_variant_columns.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261019183000_commerce_cart_default_variant_predicate.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261025120000_commerce_cart_line_offer_id.sql')
 sql+='\n\\i '+str(root/'supabase/migrations/20261025190000_commerce_cart_exact_offer_reprice.sql')
 sql+='\n'+(root/'supabase/tests/commerce_cart_line_offer_id.sql').read_text()
 sql+='\nROLLBACK;'
 r=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-h',str(p/'sock'),'-p','55489','-U','postgres','-d','postgres'],input=sql,text=True,stdout=open(p/'run.log','w'),stderr=subprocess.STDOUT,cwd=root)
 print('PASS' if r.returncode==0 else 'FAIL')
 if r.returncode: print((p/'run.log').read_text()[-2800:])
 sys.exit(r.returncode)
finally:
 if started: subprocess.run(['pg_ctl','-D',str(p/'data'),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
 shutil.rmtree(p,ignore_errors=True)
