#!/usr/bin/env python3
"""Run actual order financial leaf integration against an owned disposable PG.
--baseline proves the old leaf prices the used offer from the parent catalog.
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
        sql += (root / 'supabase/tests/commerce_cart_condition_order_assertions.sql').read_text() + '\nROLLBACK;'
        if '--baseline' not in sys.argv:
            index_migration=(root / 'supabase/migrations/20261015130800_commerce_cart_condition_offer_index.sql').read_text()
            sql+='\nCREATE TABLE public.order_items(product_offer_id uuid);\n'+index_migration+'\n'+index_migration
            sql+="\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid='public.order_items_product_offer_idx'::regclass AND indisvalid AND indrelid='public.order_items'::regclass) THEN RAISE EXCEPTION 'concurrent offer index absent or invalid'; END IF; END $$;\n"
        result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', str(socket), '-p', '55492', '-U', 'postgres', '-d', 'postgres'], input=sql, text=True, capture_output=True)
        print('PASS' if result.returncode == 0 else 'FAIL')
        if result.returncode:
            print(result.stderr[-3000:])
        sys.exit(result.returncode)
    finally:
        if started:
            subprocess.run(['pg_ctl', '-D', str(data / 'db'), 'stop', '-m', 'fast'], check=True, stdout=subprocess.DEVNULL)
