#!/usr/bin/env python3
"""Exercise signed IMEI claim contention in a disposable PostgreSQL database."""
from concurrent.futures import ThreadPoolExecutor
import os
import subprocess
import sys
import threading


def run(database: str) -> None:
    socket = os.environ.get('IMEI_TEST_PG_SOCKET')
    if socket:
        base = ['psql', '-h', socket, '-p', os.environ.get('IMEI_TEST_PG_PORT', '55439')]
    else:
        base = ['docker', 'exec', '-i', os.environ.get('IMEI_TEST_POSTGRES_CONTAINER', 'supabase_db_sb-full'), 'psql']
    base += ['-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']
    setup = "INSERT INTO private.imei_access_secrets(singleton,secret) VALUES(true,'test-imei-access-secret-at-least-32-bytes') ON CONFLICT(singleton) DO UPDATE SET secret=excluded.secret;"
    subprocess.run(base, input=setup, text=True, check=True, capture_output=True)
    for index in range(8):
        barrier = threading.Barrier(2)
        device_hash = f'{index + 1:064x}'

        previous_lookup = None
        if index >= 4:
            original_key = f'50000000-0000-4000-8000-{index:012x}'
            previous_lookup = f'60000000-0000-4000-8000-{index:012x}'
            seed = f"""INSERT INTO private.imei_attempt_claims(merchant_id,customer_id,tier,imei_hash,idempotency_key)
              VALUES('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','blacklist','{device_hash}','{original_key}');
              INSERT INTO public.imei_lookups(id,customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,cached_response,cached_status)
              VALUES('{previous_lookup}','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist','{device_hash}','{original_key}',700,'completed','{{\"success\":true}}',200);
              INSERT INTO public.customer_wallet_transactions(customer_id,merchant_id,type,status,amount,source_type,source_id)
              VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','redemption','completed',700,'imei_wallet_payment','{previous_lookup}');"""
            subprocess.run(base, input=seed, text=True, check=True, capture_output=True)

        def claim(number: int) -> str:
            request_key = f'40000000-0000-4000-8000-{index * 2 + number:012x}'
            previous_sql = f",'previous_lookup_id','{previous_lookup}'" if previous_lookup else ''
            statement = f"""
              SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
              SET ROLE authenticated;
              WITH p AS (SELECT jsonb_build_object('version',1,'actor','00000000-0000-4000-8000-000000000001',
                'customer','30000000-0000-4000-8000-000000000001','merchant','10000000-0000-4000-8000-000000000001',
                'operation','claim_attempt','issuedAt',floor(extract(epoch FROM clock_timestamp())),
                'expiresAt',floor(extract(epoch FROM clock_timestamp()))+120,
                'args',jsonb_build_object('tier','blacklist','imei_hash','{device_hash}','idempotency_key','{request_key}'{previous_sql}))::text AS payload)
              SELECT public.imei_claim_attempt(payload,encode(extensions.hmac('baci:imei-access:v1:'||payload,
                'test-imei-access-secret-at-least-32-bytes','sha256'),'hex'))->>'idempotency_key' FROM p;
            """
            barrier.wait()
            output = subprocess.run(base, input=statement, text=True, check=True, capture_output=True).stdout.splitlines()
            return output[-1]

        with ThreadPoolExecutor(max_workers=2) as executor:
            left = executor.submit(claim, 1)
            right = executor.submit(claim, 2)
            left_key, right_key = left.result(), right.result()
            if left_key != right_key or (previous_lookup and left_key == original_key):
                raise AssertionError(f'concurrent claims diverged in round {index}')


if __name__ == '__main__':
    run(sys.argv[1])
