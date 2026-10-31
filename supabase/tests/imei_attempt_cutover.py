#!/usr/bin/env python3
"""Prove a legacy write in the migration cutover gap is backfilled and fenced."""
import os
import subprocess
import time


def run(database: str, migration: str) -> None:
    socket = os.environ.get('IMEI_TEST_PG_SOCKET')
    if socket:
        base = ['psql', '-h', socket, '-p', os.environ.get('IMEI_TEST_PG_PORT', '55439')]
    else:
        base = ['docker', 'exec', '-i', os.environ.get('IMEI_TEST_POSTGRES_CONTAINER', 'supabase_db_sb-full'), 'psql']
    base += ['-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']
    marker = '-- Block old writers while taking the backfill snapshot and installing the'
    if marker not in migration:
        raise RuntimeError('cutover marker missing')
    migration = migration.replace(marker, 'CREATE TABLE public.imei_cutover_test_marker(id integer); INSERT INTO public.imei_cutover_test_marker VALUES(1); SELECT pg_sleep(2);\n' + marker)
    process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    assert process.stdin is not None
    process.stdin.write(migration)
    process.stdin.close()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        probe = subprocess.run(base, input="SELECT to_regclass('public.imei_cutover_test_marker') IS NOT NULL;", text=True, check=True, capture_output=True)
        if probe.stdout.strip() == 't':
            break
        time.sleep(0.05)
    else:
        process.terminate()
        raise RuntimeError('cutover test did not reach migration gap')
    legacy_insert = """INSERT INTO public.imei_lookups(id, customer_id, merchant_id, tier, imei_hash, idempotency_key, amount_ngn, status, cached_response, cached_status)
      VALUES ('70000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('c',64),'80000000-0000-4000-8000-000000000010',700,'completed','{"success":true}',200);"""
    subprocess.run(base, input=legacy_insert, text=True, check=True, capture_output=True)
    stderr = process.stderr.read() if process.stderr else ''
    if process.wait() != 0:
        raise RuntimeError(f'cutover migration failed: {stderr}')
    check = """DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM private.imei_attempt_claims WHERE imei_hash=repeat('c',64)
        AND idempotency_key='80000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'cutover missed legacy row'; END IF;
      BEGIN
        INSERT INTO public.imei_lookups(customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status)
        VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('c',64),'80000000-0000-4000-8000-000000000011',700,'pending');
        RAISE EXCEPTION 'legacy writer bypassed cutover fence';
      EXCEPTION WHEN unique_violation THEN NULL; END;
    END $$;"""
    subprocess.run(base, input=check, text=True, check=True, capture_output=True)
