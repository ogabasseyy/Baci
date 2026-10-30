#!/usr/bin/env python3
"""Replay actual IMEI migrations in an isolated scratch database, then drop it."""
import os
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
container = os.environ.get('IMEI_TEST_POSTGRES_CONTAINER', 'supabase_db_sb-full')
database = 'imei_boundary_' + uuid.uuid4().hex[:12]

def sql(source, db=database):
    if os.environ.get('IMEI_TEST_PG_SOCKET'):
        command=['psql','-h',os.environ['IMEI_TEST_PG_SOCKET'],'-p',os.environ.get('IMEI_TEST_PG_PORT','55439')]
    else:
        command=['docker','exec','-i',container,'psql']
    subprocess.run(command+['-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],input=source,text=True,check=True)

migrations = [
 '20260515142000_imei_lookups_table.sql',
 '20260515142100_redeem_imei_wallet_payment.sql',
 '20260516120000_fix_refund_imei_wallet_payment_no_wallet_mint.sql',
 '20260710210000_petrock_provider_product_catalog.sql',
 '20260710210100_petrock_imei_async_foundation.sql',
 '20260710210200_petrock_imei_reconciliation_rpcs.sql',
 '20260710210300_petrock_imei_status_poll_rpcs.sql',
]
try:
    sql('CREATE DATABASE '+database+';', 'postgres')
    sql((ROOT/'supabase/tests/imei_access_fixture.sql').read_text())
    for name in migrations:
        sql((ROOT/'supabase/migrations'/name).read_text())
    hardening=(ROOT/'supabase/migrations/20260712190000_petrock_codex_review_hardening.sql').read_text()
    for function in ('claim_petrock_imei_lookups','claim_petrock_imei_lookup_poll'):
        match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+function+r'\([\s\S]*?\n\$\$;',hardening)
        if not match:
            raise RuntimeError('Latest IMEI claim definition not found')
        sql(match.group(0))
    # Replay the exact latest 4-argument IMEI state function without unrelated
    # remediation/USDT migrations, whose schemas are outside this fixture.
    source=(ROOT/'supabase/migrations/20260712143000_petrock_review_recovery_hardening.sql').read_text()
    match=re.search(r'CREATE OR REPLACE FUNCTION public\.mark_petrock_imei_submission_unknown\([\s\S]*?\n\$\$;',source)
    if not match:
        raise RuntimeError('Latest IMEI state definition not found')
    sql(match.group(0))
    sql((ROOT/'supabase/migrations/20261030120000_imei_authenticated_access_boundary.sql').read_text())
    sql((ROOT/'supabase/tests/imei_authenticated_access.sql').read_text())
    print('IMEI authenticated access SQL contracts passed on disposable database.')
finally:
    sql('DROP DATABASE IF EXISTS '+database+' WITH (FORCE);', 'postgres')
