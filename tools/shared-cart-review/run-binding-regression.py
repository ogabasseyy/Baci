#!/usr/bin/env python3
"""Run checkout-binding regressions in an EMPTY disposable local database.

Usage: python3 tools/shared-cart-review/run-binding-regression.py --host LOCAL_SOCKET --port PORT --database DB
Reuses the established suite's transactional fixture and mocked order RPCs;
never connects to a remote host or loads project credentials.
"""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--host', required=True)
parser.add_argument('--port', required=True)
parser.add_argument('--database', required=True)
args = parser.parse_args()
if not args.host.startswith('/'):
    parser.error('only a local Unix socket is allowed')
root = Path(__file__).resolve().parents[2]
fixture = root / 'supabase/tests/commerce_cart_order_binding.sql'
sql = fixture.read_text().split('-- 7. Bound submission')[0]
lines = []
for line in sql.splitlines():
    if line.startswith('\\ir '):
        line = '\\i ' + str((fixture.parent / line[4:]).resolve())
    lines.append(line)
lines.append('\\i ' + str(root / 'supabase/migrations/20261014141000_commerce_cart_checkout_lifetime.sql'))
lines.append('\\i ' + str(root / 'supabase/tests/commerce_cart_review_binding_guards.sql'))
lines.append('ROLLBACK;')
subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', args.host,
                '-p', args.port, '-U', 'postgres', '-d', args.database],
               input='\n'.join(lines), text=True, check=True, cwd=root)
