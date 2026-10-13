import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


class ReceiptSignatureStorage(unittest.TestCase):
    def test_atomic_provenance_lease_fences_races_and_restart(self):
        self.rehearse(with_service_role=True)

    def test_receipt_only_database_without_service_role_installs_without_creating_it(self):
        self.rehearse(with_service_role=False)

    def rehearse(self, with_service_role):
        binary = Path(os.environ.get('PVB_TEST_PG_BIN', '/opt/homebrew/opt/postgresql@18/bin'))
        source = Path(__file__).parent
        environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        with tempfile.TemporaryDirectory(prefix='pvb-signature-') as directory:
            root = Path(directory)
            data = root / 'data'

            def run(command, **options):
                return subprocess.run([str(item) for item in command], env=environment, text=True,
                                      capture_output=True, check=True, timeout=60, **options)

            run([binary / 'initdb', '-D', data, '-U', 'supabase_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
            launch = [binary / 'pg_ctl', '-D', data, '-l', root / 'server.log', '-o', f"-k {root} -h ''", '-w']
            run([*launch, 'start'])
            command = [binary / 'psql', '-X', '-w', '-h', root, '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt']

            def query(sql):
                return run(command, input=sql).stdout.strip()

            try:
                query('CREATE ROLE anon; CREATE ROLE authenticated; '
                      'CREATE ROLE authenticator NOINHERIT; REVOKE CREATE ON SCHEMA public FROM PUBLIC;')
                if with_service_role:
                    query('CREATE ROLE service_role;')
                identifier = query('SELECT system_identifier FROM pg_control_system();')
                self.assertNotEqual(identifier, '7686901100561231906')
                for filename in ['ingest-storage.sql', 'replay-storage.sql']:
                    run([*command, '-v', f'expected_system_identifier={identifier}'], input=(source / filename).read_text())
                runtime = (source / 'replay-runtime-storage.sql').read_text()
                self.assertEqual(runtime.count('7686901100561231906'), 1)
                query(runtime.replace('7686901100561231906', identifier))
                if with_service_role:
                    query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role; '
                          'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;')
                script = (source / 'receipt-signature-storage.sql').read_text()
                with self.assertRaises(subprocess.CalledProcessError):
                    run([*command, '-v', 'expected_system_identifier=1'], input=script)
                self.assertEqual(query("SELECT to_regclass('public.piggyvest_staging_receipt_signatures') IS NULL;"), 't')
                run([*command, '-v', f'expected_system_identifier={identifier}'], input=script)
                self.assertEqual(query("SELECT to_regrole('service_role') IS NOT NULL;"),
                                 't' if with_service_role else 'f')
                query((source / 'receipt-signature-storage.test.sql').read_text())
                delivery = "SET ROLE pvb_staging_ingest; SELECT public.accept_signed_piggyvest_staging_receipt(" \
                           "repeat('e',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1',repeat('Ab',64))->>'receiptId';"
                with ThreadPoolExecutor(max_workers=8) as pool:
                    identities = list(pool.map(lambda _: query(delivery), range(8)))
                self.assertEqual(len(set(identities)), 1)
                self.assertEqual(query('SELECT count(*) FROM public.piggyvest_staging_receipts;'), '1')
                self.assertEqual(query('SELECT count(*) FROM public.piggyvest_staging_receipt_signatures;'), '1')
                run([*launch, '-m', 'fast', 'restart'])
                self.assertEqual(query("SET ROLE pvb_staging_worker; SELECT public.read_piggyvest_staging_receipt_signature("
                                       "receipt_id,payload_sha256,claim_token)->>'signature' "
                                       "FROM public.claim_piggyvest_staging_receipts(1,300);"), 'Ab' * 64)
                receipt_id = identities[0]
                claim_token = query(f"SELECT claim_token FROM public.piggyvest_staging_receipts WHERE id='{receipt_id}';")
                query(f"UPDATE public.piggyvest_staging_receipts SET lease_expires_at=clock_timestamp()+interval '3 seconds' WHERE id='{receipt_id}';")
                blocker = subprocess.Popen([str(item) for item in command], env=environment, text=True,
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    blocker.stdin.write(f"BEGIN; SELECT id FROM public.piggyvest_staging_receipts WHERE id='{receipt_id}' FOR UPDATE;\n\\echo LOCKED\n")
                    blocker.stdin.flush()
                    while blocker.stdout.readline().strip() != 'LOCKED':
                        if blocker.poll() is not None:
                            self.fail('Receipt lock fixture exited')
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        reading = pool.submit(query, "SET application_name='signature_expiry_reader'; SET ROLE pvb_staging_worker; "
                                              f"SELECT public.read_piggyvest_staging_receipt_signature('{receipt_id}',repeat('e',64),'{claim_token}') IS NULL;")
                        try:
                            deadline = time.monotonic() + 5
                            while query("SELECT count(*) FROM pg_stat_activity WHERE application_name='signature_expiry_reader' AND wait_event_type='Lock';") != '1':
                                if reading.done() or time.monotonic() >= deadline:
                                    self.fail('Signature reader did not reach the receipt lock')
                                time.sleep(0.01)
                            while query(f"SELECT lease_expires_at<=clock_timestamp() FROM public.piggyvest_staging_receipts WHERE id='{receipt_id}';") != 't':
                                if time.monotonic() >= deadline:
                                    self.fail('Synthetic lease did not expire')
                                time.sleep(0.01)
                        finally:
                            blocker.stdin.write('ROLLBACK;\n\\q\n')
                            blocker.stdin.flush()
                            blocker.wait(timeout=5)
                        self.assertEqual(reading.result(timeout=5), 't', 'A lease expiring during a lock wait exposed the signature')
                finally:
                    if blocker.poll() is None:
                        blocker.kill()
                        blocker.wait(timeout=5)
                    for stream in [blocker.stdin, blocker.stdout, blocker.stderr]:
                        stream.close()
            finally:
                run([binary / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])


if __name__ == '__main__':
    unittest.main()
