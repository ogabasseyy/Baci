#!/usr/bin/env python3
"""Run final binding plus real financial leaf in owned disposable PostgreSQL.
--before-agentic-economics-fix reproduces wrong prices; --voucher-only isolates
the unauthorized base-voucher path. No credentials or real orders are used.
"""
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='cart-condition-order-') as directory:
    data = Path(directory)
    socket = data / 'socket'
    socket.mkdir()
    started = False
    try:
        with (data / 'setup.log').open('w') as log:
            subprocess.run(['initdb', '-D', str(data / 'db'), '-U', 'postgres', '--auth=trust', '--no-locale'], check=True, stdout=log, stderr=log)
            subprocess.run(['pg_ctl', '-D', str(data / 'db'), '-l', str(data / 'pg.log'), '-o', f"-h '' -k {socket} -p 55492", 'start'], check=True, stdout=log, stderr=log)
            started = True
        sql = 'BEGIN; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;\n'
        sql += (root / 'supabase/tests/commerce_cart_condition_order.sql').read_text()
        sql += '\nCREATE SCHEMA discovery;\n'
        canonical = (root / 'supabase/migrations/20261001170000_canonical_product_condition.sql').read_text()
        sql += canonical
        currency=(root / 'supabase/migrations/20261015130400_commerce_cart_verified_legacy_bridge.sql').read_text()
        sql += re.search(r'CREATE OR REPLACE FUNCTION public\.commerce_cart_resolve_merchant_currency\([\s\S]*?\$\$;',currency).group()
        negotiation = (root / 'supabase/migrations/20261015090000_commerce_cart_negotiation_policy.sql').read_text()
        sql += re.search(r'CREATE OR REPLACE FUNCTION public.commerce_cart_product_negotiable\([\s\S]*?\$\$;', negotiation).group()
        old = (root / 'supabase/migrations/20260709100000_orders_currency_from_merchant_payout.sql').read_text()
        sql += re.search(r'CREATE OR REPLACE FUNCTION private.create_storefront_order\([\s\S]*?\$\$;', old).group()
        sql += (root / 'supabase/migrations/20260828130000_scope_storefront_order_replay_route_context.sql').read_text()
        if '--baseline' not in sys.argv:
            fixed = (root / 'supabase/migrations/20261015130500_commerce_cart_condition_order_pricing.sql').read_text()
            sql += fixed[:fixed.index('-- Condition-aware order pricing')]
            sql += re.search(r'CREATE OR REPLACE FUNCTION public\.commerce_cart_condition_pool_is_quantity_managed\([\s\S]*?\$\$;',fixed).group()
            sql += re.search(r'CREATE OR REPLACE FUNCTION private.create_storefront_order_unchecked\([\s\S]*?\$\$;', fixed).group()
            sql += fixed[fixed.index('-- Safe projection for order-route'):]
        if '--baseline' not in sys.argv:
            repair=(root / 'supabase/migrations/20261015140000_commerce_cart_claim_lock_order.sql').read_text()
            sql += repair + repair  # Reapplying is safe and preserves the required loop.
        sql += (root / 'supabase/migrations/20261012050000_commerce_cart_core.sql').read_text()
        checkout=(root / 'supabase/migrations/20261012050600_commerce_cart_order_binding.sql').read_text()
        sql += checkout[:checkout.index('-- Checkout snapshot builder:')]
        sql += "\nCREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$; ALTER TABLE public.commerce_cart_grants ADD COLUMN device_principal_id text; CREATE TABLE public.commerce_cart_device_retirements(merchant_id uuid,device_principal_id text); ALTER TABLE public.commerce_cart_lines ADD COLUMN last_unit_price_minor bigint; ALTER TABLE products ADD COLUMN stock integer,ADD COLUMN has_variants boolean DEFAULT false; ALTER TABLE product_variants ADD COLUMN is_default boolean DEFAULT false; ALTER TABLE variant_inventory ADD COLUMN product_id uuid;"
        sql += "\nCREATE FUNCTION public.get_public_serialized_variant_availability_counts(uuid,uuid[],uuid) RETURNS TABLE(product_id uuid,variant_id uuid,public_available_units integer) LANGUAGE sql STABLE AS $$ SELECT NULL::uuid,NULL::uuid,0 WHERE false $$;"
        writer=(root / 'supabase/migrations/20261015130000_commerce_cart_final_writer_guards.sql').read_text()
        sql += re.search(r'CREATE OR REPLACE FUNCTION public.commerce_cart_offer_price_minor\([\s\S]*?\$\$;',writer).group()
        authority=(root / 'supabase/migrations/20261015130100_commerce_cart_checkout_authority.sql').read_text()
        sql += authority[:authority.index('CREATE OR REPLACE FUNCTION public.commerce_cart_build_checkout_snapshot')]
        sql += re.search(r'CREATE OR REPLACE FUNCTION public.commerce_cart_prepare_checkout\([\s\S]*?\$\$;',authority).group()
        sql += re.search(r'CREATE OR REPLACE FUNCTION public.create_storefront_order_with_cart_binding\([\s\S]*?\$\$;',authority).group()
        for helper_name in ['commerce_cart_condition_supported','commerce_cart_offer_price_minor']:
            sql += re.search(r'CREATE OR REPLACE FUNCTION public\.'+helper_name+r'\([\s\S]*?\$\$;',fixed).group()
        sql += re.search(r'CREATE OR REPLACE FUNCTION public.commerce_cart_build_checkout_snapshot\([\s\S]*?\$\$;',fixed).group()
        lifetime=(root / 'supabase/migrations/20261015144000_commerce_cart_checkout_add_identity.sql').read_text()
        sql += lifetime.split('-- Match the final replace writer')[0]
        sql += (root / 'supabase/migrations/20261015145000_commerce_cart_checkout_complete_vouchers.sql').read_text()
        # Capture the public argument boundary, then delegate to the ACTUAL final
        # private replay wrapper and financial/inventory transaction.
        actual=re.search(r'CREATE OR REPLACE FUNCTION private.create_storefront_order\([\s\S]*?\$\$;', (root / 'supabase/migrations/20260828130000_scope_storefront_order_replay_route_context.sql').read_text()).group()
        capture=actual.replace('FUNCTION private.create_storefront_order(','FUNCTION public.create_storefront_order(',1)
        capture=capture.replace('BEGIN',"BEGIN\n INSERT INTO public.agentic_binding_calls(discount,expected,items) VALUES(p_discount_amount,p_expected_total,p_items);",1)
        sql += "\nCREATE TABLE public.agentic_binding_calls(discount numeric,expected numeric,items jsonb);\n"+capture
        if '--before-agentic-economics-fix' not in sys.argv:
            sql += (root / 'supabase/migrations/20261015150000_commerce_cart_agentic_checkout_economics.sql').read_text()*2
        if '--before-partial-voucher-binding-fix' not in sys.argv:
            sql += (root / 'supabase/migrations/20261015151000_commerce_cart_partial_voucher_binding.sql').read_text()*2
        assertions=(root / 'supabase/tests/commerce_cart_agentic_checkout_economics.sql').read_text()
        if '--voucher-only' in sys.argv: assertions=assertions.replace('FOR n IN 1..6 LOOP','FOR n IN 2..2 LOOP')
        sql += assertions
        sql += (root / 'supabase/tests/commerce_cart_partial_voucher_binding.sql').read_text()+'\nROLLBACK;'
        result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', str(socket), '-p', '55492', '-U', 'postgres', '-d', 'postgres'], input=sql, text=True, capture_output=True)
        print('PASS' if result.returncode == 0 else 'FAIL')
        if result.returncode:
            print(result.stderr[:1200]+result.stderr[-1200:])
        sys.exit(result.returncode)
    finally:
        if started:
            subprocess.run(['pg_ctl', '-D', str(data / 'db'), 'stop', '-m', 'fast'], check=True, stdout=subprocess.DEVNULL)
