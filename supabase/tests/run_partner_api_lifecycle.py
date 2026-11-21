#!/usr/bin/env python3
"""Run partner route handlers through Supabase-js, PostgREST and the Baci order writer."""

from base64 import urlsafe_b64encode
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from run_partner_order_real_storefront_writer import ROOT, SQL_TESTS, migration, partner_schema_sql


DATABASE_PORT = '55469'
FIXTURE_PROOF_KEY = 'baci-fixture-partner-lifecycle-local-proof-only'
TEST_FILE = 'src/app/api/partners/v1/partner-lifecycle.test.ts'


def anon_jwt(secret):
    def encode(value):
        return urlsafe_b64encode(value).rstrip(b'=')

    header = encode(b'{"typ":"JWT","alg":"HS256"}')
    payload = encode(json.dumps({'role': 'anon', 'exp': int(time.time()) + 300}).encode())
    data = header + b'.' + payload
    signature = hmac.new(secret.encode(), data, hashlib.sha256).digest()
    return (data + b'.' + encode(signature)).decode()


def seed_fixture(directory):
    writer_fixture = (SQL_TESTS / 'partner_order_real_storefront_writer.sql').read_text()
    seed = writer_fixture.split('BEGIN;\n', 1)[1].split('\nDO $$', 1)[0]
    sql = '\n'.join([
        *partner_schema_sql(),
        """
        CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
        CREATE SCHEMA vault;
        CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
        CREATE ROLE baci_fixture_api LOGIN NOINHERIT;
        GRANT anon, authenticated TO baci_fixture_api;
        ALTER TABLE public.products ADD COLUMN weight_value numeric DEFAULT 500,
          ADD COLUMN weight_unit text DEFAULT 'g', ADD COLUMN dimensions jsonb;
        GRANT SELECT (id, merchant_id, name, weight_value, weight_unit, dimensions, vat_category_code, vat_rate)
          ON public.products TO anon;
        GRANT SELECT (id, vat_registration_status) ON public.merchants TO anon;
        """,
        f"INSERT INTO vault.decrypted_secrets VALUES ('service_role_key', '{FIXTURE_PROOF_KEY}');",
        f"BEGIN;\n{seed}\nCOMMIT;",
        (ROOT / 'supabase/tests/partner_api_lifecycle_fulfillment_fixture.sql').read_text(),
        migration('20261114100000'),
    ])
    subprocess.run(
        ['psql', '-Xq', '-v', 'ON_ERROR_STOP=1', '-h', str(directory), '-p', DATABASE_PORT,
         '-U', 'postgres', '-d', 'postgres'],
        input=sql, text=True, check=True,
    )


@contextmanager
def database(directory):
    data = str(directory / 'data')
    subprocess.run(
        ['initdb', '-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'],
        stdout=subprocess.DEVNULL, check=True,
    )
    subprocess.run(
        ['pg_ctl', '-D', data, '-l', str(directory / 'postgres.log'),
         '-o', f"-h '' -k '{directory}' -p {DATABASE_PORT}", '-w', 'start'],
        stdout=subprocess.DEVNULL, check=True,
    )
    try:
        seed_fixture(directory)
        yield
    finally:
        subprocess.run(
            ['pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'],
            stdout=subprocess.DEVNULL, check=True,
        )


@contextmanager
def postgrest(directory, jwt_secret):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    query = urlencode({'host': str(directory), 'port': DATABASE_PORT})
    env = {
        'PATH': os.environ['PATH'],
        'PGRST_DB_URI': f'postgresql://baci_fixture_api@/postgres?{query}',
        'PGRST_DB_SCHEMAS': 'public',
        'PGRST_DB_ANON_ROLE': 'anon',
        'PGRST_SERVER_HOST': '127.0.0.1',
        'PGRST_SERVER_PORT': str(port),
        'PGRST_JWT_SECRET': jwt_secret,
    }
    log_path = directory / 'postgrest.log'
    with log_path.open('w') as log, subprocess.Popen(
        ['postgrest'], env=env, stdout=log, stderr=subprocess.STDOUT,
    ) as process:
        try:
            for _ in range(50):
                if process.poll() is not None:
                    break
                try:
                    with urlopen(base, timeout=0.5) as response:
                        if response.status == 200:
                            break
                except URLError:
                    time.sleep(0.1)
            else:
                raise RuntimeError(f'PostgREST did not become ready:\n{log_path.read_text()}')
            if process.poll() is not None:
                raise RuntimeError(f'PostgREST exited:\n{log_path.read_text()}')
            yield base
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


def run():
    jwt_secret = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix='baci-partner-api-') as temporary:
        directory = Path(temporary)
        with database(directory), postgrest(directory, jwt_secret) as base:
            env = {
                **os.environ,
                'BACI_PARTNER_LIFECYCLE_SOCKET': str(directory),
                'BACI_PARTNER_LIFECYCLE_PORT': DATABASE_PORT,
                'NEXT_PUBLIC_SUPABASE_URL': base,
                'NEXT_PUBLIC_SUPABASE_ANON_KEY': anon_jwt(jwt_secret),
                'SUPABASE_SERVICE_ROLE_KEY': FIXTURE_PROOF_KEY,
                'SUPABASE_JWT_SECRET': jwt_secret,
                'SUPABASE_AGENTIC_JWT_PRIVATE_JWK': '',
            }
            subprocess.run(
                [str(ROOT / 'node_modules/.bin/vitest'), 'run', '--root', 'apps/web', TEST_FILE],
                cwd=ROOT, env=env, check=True,
            )


if __name__ == '__main__':
    run()
